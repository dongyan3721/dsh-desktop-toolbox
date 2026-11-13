/**
 * 便笺渲染安全清洗器（零第三方依赖）。
 * 目标：Agent 共享内容中的原始 HTML 事件、脚本、javascript: URL、任意 HTML IPC 桥
 * 一律不能进入 v-html；同时保留正常 Markdown 结构与 KaTeX（HTML + MathML）输出。
 *
 * 策略：逐标签词法扫描 + 标签/属性白名单。
 * - script/style/iframe 等危险容器连同内容整体丢弃；
 * - 所有 on* 事件属性、危险 URL 协议、CSS url()/expression() 一律剥离；
 * - 未知标签丢弃标签本身、保留纯文本；未闭合的尾部标签整体丢弃。
 */

const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript',
  'textarea', 'title', 'xmp', 'plaintext', 'noembed', 'noframes',
]);

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Markdown + 通用排版输出允许的 HTML 标签 */
const HTML_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd',
  'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small',
  'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'ul', 'var', 'wbr',
]);

/** KaTeX MathML 输出所需的展示型标签 */
const MATHML_TAGS = new Set([
  'math', 'semantics', 'annotation', 'annotation-xml', 'mrow', 'mi', 'mn', 'mo',
  'ms', 'mtext', 'mspace', 'msub', 'msup', 'msubsup', 'mfrac', 'msqrt', 'mroot',
  'mstyle', 'merror', 'mpadded', 'mphantom', 'munder', 'mover', 'munderover',
  'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mtd', 'mlabeledtr',
]);

/** KaTeX 拉伸符号等使用的安全 SVG 子集（无 href/use/animate/script） */
const SVG_TAGS = new Set(['svg', 'path', 'line', 'g', 'rect', 'circle', 'ellipse', 'polygon', 'polyline']);

const HTML_ATTRS = new Set([
  'class', 'title', 'alt', 'width', 'height', 'align', 'colspan', 'rowspan',
  'scope', 'start', 'reversed', 'type', 'open', 'lang', 'dir', 'checked',
  'disabled', 'download', 'datetime', 'cite', 'headers', 'axis',
]);

const MATHML_ATTRS = new Set([
  'class', 'encoding', 'xmlns', 'mathvariant', 'mathsize', 'mathcolor',
  'mathbackground', 'display', 'displaystyle', 'scriptlevel', 'stretchy',
  'fence', 'separator', 'accent', 'accentunder', 'open', 'close', 'separators',
  'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'columnlines',
  'rowlines', 'voffset', 'width', 'height', 'depth', 'minsize', 'maxsize',
  'lspace', 'rspace', 'movablelimits', 'largeop', 'symmetric', 'linebreak',
  'linethickness', 'side', 'framespacing', 'equalrows', 'equalcolumns',
]);

const SVG_ATTRS = new Set([
  'class', 'xmlns', 'viewbox', 'preserveaspectratio', 'width', 'height', 'x', 'y',
  'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'transform', 'opacity', 'fill-opacity', 'stroke-opacity', 'vector-effect',
]);

const STYLE_PROPS = new Set([
  'font-size', 'font-family', 'font-weight', 'font-style', 'font-variant',
  'color', 'background-color', 'text-align', 'text-decoration',
  'text-decoration-line', 'text-decoration-style', 'text-decoration-color',
  'text-indent', 'vertical-align', 'margin', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'top', 'right', 'bottom', 'left', 'width',
  'height', 'min-width', 'min-height', 'max-width', 'max-height', 'line-height',
  'display', 'position', 'border', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'border-width', 'border-style', 'border-color', 'border-radius',
  'border-collapse', 'opacity', 'white-space', 'overflow-wrap', 'word-break',
  'transform', 'letter-spacing', 'list-style-type', 'vertical-align',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", tab: '\t', newline: '\n', colon: ':', sol: '/',
};

function decodeEntities(value: string): string {
  return value.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));?/g, (match, hex, dec, named) => {
    if (hex || dec) {
      const point = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : '\ufffd';
    }
    const key = String(named).toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** URL 白名单：链接仅 http/https/mailto/tel/锚点；图片仅 http(s) 与安全位图 data URI */
function safeUrl(value: string, kind: 'link' | 'img'): string | null {
  const decoded = decodeEntities(value);
  // 浏览器会在 URL 中忽略 ASCII 空白与控制符，先剔除再判协议，防止 java\tscript: 之类绕过
  const cleaned = decoded.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();
  if (cleaned.startsWith('#')) return value;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(cleaned);
  if (!scheme) return null;
  const proto = scheme[1];
  if (kind === 'link') {
    return proto === 'http' || proto === 'https' || proto === 'mailto' || proto === 'tel' ? value : null;
  }
  if (proto === 'http' || proto === 'https') return value;
  if (proto === 'data' && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(cleaned)) return value;
  return null;
}

function safeStyle(value: string): string {
  const decoded = decodeEntities(value);
  const lower = decoded.toLowerCase();
  if (
    lower.includes('url(')
    || lower.includes('expression(')
    || lower.includes('javascript')
    || lower.includes('vbscript')
    || lower.includes('@import')
    || lower.includes('/*')
    || decoded.includes('\\')
  ) {
    return '';
  }
  const out: string[] = [];
  for (const decl of decoded.split(';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!val || !STYLE_PROPS.has(prop)) continue;
    if (prop === 'position' && !/^(relative|absolute|static)$/i.test(val)) continue;
    if (/[<>"']/.test(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
}

function allowedAttrsFor(tag: string): Set<string> {
  if (MATHML_TAGS.has(tag)) return MATHML_ATTRS;
  if (SVG_TAGS.has(tag)) return SVG_ATTRS;
  return HTML_ATTRS;
}

interface RawAttr {
  name: string;
  value: string;
}

function parseAttrs(source: string): RawAttr[] {
  const attrs: RawAttr[] = [];
  const pattern = /([a-zA-Z_:@-][a-zA-Z0-9_:.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    attrs.push({ name: match[1], value: match[2] ?? match[3] ?? match[4] ?? '' });
  }
  return attrs;
}

function sanitizeAttrs(tag: string, rawAttrs: RawAttr[]): string {
  const allowed = allowedAttrsFor(tag);
  const out: string[] = [];
  for (const attr of rawAttrs) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) continue;
    if (name === 'srcset' || name === 'xlink:href' || name === 'href' && tag !== 'a') continue;
    if ((name === 'src' || name === 'poster' || name === 'data' || name === 'action' || name === 'formaction') && !(tag === 'img' && name === 'src')) continue;
    if (name === 'style') {
      const style = safeStyle(attr.value);
      if (style) out.push(`style="${escapeAttr(style)}"`);
      continue;
    }
    if (tag === 'a' && name === 'href') {
      const url = safeUrl(attr.value, 'link');
      if (url === null) continue;
      out.push(`href="${escapeAttr(url)}"`);
      continue;
    }
    if (tag === 'img' && name === 'src') {
      const url = safeUrl(attr.value, 'img');
      if (url === null) continue;
      out.push(`src="${escapeAttr(url)}"`);
      continue;
    }
    if (tag === 'input') {
      if (name === 'type') { out.push('type="checkbox"'); continue; }
      if (name === 'checked' || name === 'disabled') { out.push(name); continue; }
    }
    if (name === 'class' || name.startsWith('aria-') || name === 'role' || allowed.has(name)) {
      if (name === 'checked' || name === 'disabled' || name === 'open' || name === 'reversed') {
        out.push(name);
      } else {
        out.push(`${name}="${escapeAttr(attr.value)}"`);
      }
    }
  }
  return out.length > 0 ? ` ${out.join(' ')}` : '';
}

/**
 * 清洗不可信 HTML（Markdown/KaTeX 渲染产物）。
 * 输出保证不含脚本执行面：script、事件属性、javascript: URL、危险 CSS 一律不存在。
 */
export function sanitizeHtml(html: string): string {
  let out = '';
  let i = 0;
  const len = html.length;

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);

    // 注释、DOCTYPE、处理指令整体丢弃
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2);
      i = end < 0 ? len : end + 1;
      continue;
    }

    const closeMatch = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(html.slice(lt));
    if (closeMatch) {
      const tag = closeMatch[1].toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) {
        i = lt + closeMatch[0].length;
        continue;
      }
      if (HTML_TAGS.has(tag) || MATHML_TAGS.has(tag) || SVG_TAGS.has(tag)) {
        out += `</${tag}>`;
      }
      i = lt + closeMatch[0].length;
      continue;
    }

    const openMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt));
    if (!openMatch) {
      // 裸 < 以文本转义输出，防止后续拼接出标签
      out += '&lt;';
      i = lt + 1;
      continue;
    }

    const tag = openMatch[1].toLowerCase();

    // 从 <tag 起找到匹配的标签结束 >（引号感知）
    let cursor = lt + openMatch[0].length;
    let quote: string | null = null;
    let closed = false;
    while (cursor < len) {
      const ch = html[cursor];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        closed = true;
        break;
      }
      cursor += 1;
    }
    if (!closed) {
      // 未闭合的尾部标签整体丢弃
      break;
    }

    const inner = html.slice(lt + openMatch[0].length, cursor);
    const selfClosing = /\/\s*$/.test(inner);
    const attrSource = selfClosing ? inner.replace(/\/\s*$/, '') : inner;

    if (DROP_WITH_CONTENT.has(tag)) {
      const closeTag = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = html.slice(cursor + 1);
      const endMatch = closeTag.exec(rest);
      i = endMatch ? cursor + 1 + endMatch.index + endMatch[0].length : len;
      continue;
    }

    if (HTML_TAGS.has(tag) || MATHML_TAGS.has(tag) || SVG_TAGS.has(tag)) {
      const attrs = sanitizeAttrs(tag, parseAttrs(attrSource));
      const isVoid = VOID_TAGS.has(tag) || selfClosing;
      out += isVoid ? `<${tag}${attrs} />` : `<${tag}${attrs}>`;
    }
    // 未知标签：丢弃标签标记，保留内层文本
    i = cursor + 1;
  }

  return out;
}
