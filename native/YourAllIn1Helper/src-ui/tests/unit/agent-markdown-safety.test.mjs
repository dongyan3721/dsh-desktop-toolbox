/**
 * Agent 共享 Markdown 安全测试（恶意合成内容）。
 * 覆盖：
 * 1. sanitizeHtml 对脚本、事件属性、javascript:/data: URL、危险容器与 CSS 的剥离
 * 2. 正常 Markdown / KaTeX (LaTeX) 在清洗后完整保留
 * 3. StickyNote renderedHtml 端到端：Agent 写入的恶意 content_md 不得形成可执行 HTML
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { marked } from 'marked';
import katex from 'katex';

function compileInto(code, context) {
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
}

const safeHtmlSource = await readFile(new URL('../../src/utils/safeHtml.ts', import.meta.url), 'utf8');

const safeContext = vm.createContext({});
compileInto(safeHtmlSource.replace(/export /g, ''), safeContext);
const sanitizeHtml = (input) => vm.runInContext(`sanitizeHtml(${JSON.stringify(input)})`, safeContext);

/** 通用危险模式断言：任何渲染产物都不得包含这些可执行面 */
function assertSafe(output, label) {
  assert.ok(!/<script/i.test(output), `${label}: must not contain <script>`);
  assert.ok(!/\son[a-z]+\s*=/i.test(output), `${label}: must not contain inline event handlers`);
  assert.ok(
    !/(href|src|xlink:href|action|formaction|data)\s*=\s*["']?\s*(javascript|vbscript|data:text\/html)/i.test(output),
    `${label}: must not contain executable URL schemes`,
  );
  assert.ok(!/<iframe|<object|<embed|<form|<base|<meta|<link|<style/i.test(output), `${label}: must not contain dangerous containers`);
}

const maliciousFixtures = [
  ['script executes nothing', '<script>window.__TAURI__.core.invoke("kernel_shutdown")</script>'],
  ['img onerror dropped', '<img src=x onerror="window.__TAURI__.core.invoke(\'kernel_shutdown\')">'],
  ['javascript href dropped', '<a href="javascript:alert(1)">click</a>'],
  ['entity-encoded javascript href dropped', '<a href="&#106;avascript:alert(1)">click</a>'],
  ['tab-split javascript href dropped', '<a href="jav&#x09;ascript:alert(1)">click</a>'],
  ['uppercase javascript href dropped', '<A HREF="JaVaScRiPt:alert(1)">click</A>'],
  ['data:text/html href dropped', '<a href="data:text/html,<script>alert(1)</script>">click</a>'],
  ['onclick dropped', '<div onclick="evil()">click me</div>'],
  ['iframe dropped with content', '<iframe src="https://evil.example/x"></iframe>'],
  ['svg onload dropped', '<svg onload="evil()"><path d="M0 0 L10 10"></path></svg>'],
  ['style import dropped', '<style>@import url(https://evil.example);</style>'],
  ['fixed overlay style dropped', '<div style="position:fixed;inset:0;background:#000">overlay</div>'],
  ['css url() dropped', '<div style="background:url(javascript:alert(1))">x</div>'],
  ['css expression dropped', '<div style="width:expression(alert(1))">x</div>'],
  ['form action dropped', '<form action="javascript:evil()"><input type="submit"></form>'],
  ['svg data uri img dropped', '<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">'],
  ['unclosed tail dropped', '<img src=x onerror=alert(1)'],
  ['mixed case attributes dropped', '<IMG SRC="x" ONERROR="alert(1)">'],
  ['mathml script dropped', '<math><mtext><script>alert(1)</script></mtext></math>'],
  ['base tag dropped', '<base href="javascript:alert(1)">'],
  ['meta refresh dropped', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ['object dropped with content', '<object data="javascript:evil()">payload</object>'],
  ['comment smuggle dropped', '><!--><script>alert(1)</script>-->'],
  ['mouseover dropped', '<div title="x" ONMOUSEOVER="evil()">y</div>'],
  ['svg use href dropped', '<svg><use href="data:image/svg+xml;base64,AAAA"></use></svg>'],
  ['mailto capture javascript dropped', '<a href="javascript&colon;alert(1)">x</a>'],
  ['formaction on button dropped', '<button formaction="javascript:evil()">go</button>'],
  ['nested event in span dropped', '<span onanimationstart="evil()">x</span>'],
  ['srcset dropped', '<img srcset="javascript:alert(1) 1x" src="https://example.com/a.png">'],
];

for (const [label, fixture] of maliciousFixtures) {
  test(`sanitizeHtml strips ${label}`, () => {
    const out = sanitizeHtml(fixture);
    assertSafe(out, label);
  });
}

test('sanitizeHtml keeps benign links and images', () => {
  const out = sanitizeHtml('<a href="https://example.com/a?b=1#x">ok</a> <img src="https://example.com/i.png" alt="i">');
  assert.ok(out.includes('href="https://example.com/a?b=1#x"'), 'benign https link kept');
  assert.ok(out.includes('src="https://example.com/i.png"'), 'benign https image kept');
});

test('sanitizeHtml keeps task-list checkboxes and plain text mentioning javascript', () => {
  const out = sanitizeHtml('<input type="checkbox" checked disabled> <p>javascript: appears as text only</p>');
  assert.ok(out.includes('type="checkbox"'), 'checkbox kept');
  assert.ok(out.includes('checked'), 'checked state kept');
  assert.ok(out.includes('appears as text only'), 'text kept');
});

/** 端到端渲染管线：与 StickyNote.renderedHtml 相同的 marked + katex + sanitizeHtml 流程 */
function renderLikeSticky(contentMd) {
  let content = contentMd || '';
  if (!content.trim()) return sanitizeHtml('<p>empty</p>');
  content = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, mathExpr) => {
    try {
      return `<div class="katex-block-wrap">${katex.renderToString(mathExpr.trim(), { displayMode: true, throwOnError: false })}</div>`;
    } catch {
      return `<div class="katex-error">${mathExpr}</div>`;
    }
  });
  content = content.replace(/\$([^\$\n]+?)\$/g, (_, mathExpr) => {
    try {
      return katex.renderToString(mathExpr.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `$${mathExpr}$`;
    }
  });
  try {
    return sanitizeHtml(marked.parse(content, { breaks: true, gfm: true }));
  } catch {
    return sanitizeHtml(content);
  }
}

test('markdown structures survive sanitization', () => {
  const out = renderLikeSticky('# 标题\n\n- 一\n- 二\n\n**粗** *斜* `code` [链接](https://example.com)\n\n| a | b |\n| - | - |\n| 1 | 2 |');
  assert.ok(out.includes('<h1'), 'heading kept');
  assert.ok(out.includes('<li'), 'list kept');
  assert.ok(out.includes('<strong'), 'bold kept');
  assert.ok(out.includes('<em'), 'italic kept');
  assert.ok(out.includes('<code'), 'code kept');
  assert.ok(out.includes('href="https://example.com"'), 'link kept');
  assert.ok(out.includes('<table'), 'table kept');
  assertSafe(out, 'markdown structures');
});

test('KaTeX inline and block math survive sanitization', () => {
  const out = renderLikeSticky('公式 $x^2$ 与 $$\\frac{1}{2}$$');
  assert.ok(out.includes('class="katex"'), 'katex output kept');
  assert.ok(out.includes('katex-block-wrap'), 'block math wrapper kept');
  assertSafe(out, 'katex math');
});

test('malicious markdown mixed with normal content keeps the normal content', () => {
  const out = renderLikeSticky('# 正常标题\n\n<script>evil()</script>\n\n**保留段落**\n\n[x](javascript:evil())');
  assert.ok(out.includes('<h1'), 'heading kept');
  assert.ok(out.includes('保留段落'), 'paragraph text kept');
  assertSafe(out, 'mixed content');
});

/* ==================== StickyNote renderedHtml 端到端（Agent 写入的 content_md） ==================== */

const stickySource = await readFile(new URL('../../src/components/StickyNote.vue', import.meta.url), 'utf8');

async function loadRenderedHtml(contentMd) {
  const scriptMatch = stickySource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'must load the actual sticky note script');
  const script = scriptMatch[1].replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
  const context = vm.createContext({
    ref: (value) => ({ value }),
    computed: (get) => ({ get value() { return get(); } }),
    defineProps: () => ({ noteId: 'qa-note' }),
    onMounted() {},
    onUnmounted() {},
    t: (key) => key,
    notify() {},
    URLSearchParams,
    window: { location: { search: '' }, __TAURI__: { event: { listen: () => Promise.resolve(() => {}) } } },
    setTimeout: () => 0,
    clearTimeout: () => {},
    console: { error: () => {} },
    invokeIpc: async () => ({}),
    marked,
    katex,
    sanitizeHtml,
  });
  compileInto(script, context);
  vm.runInContext(`note.value.content_md = ${JSON.stringify(contentMd)}`, context);
  return vm.runInContext('renderedHtml.value', context);
}

test('StickyNote renderedHtml neutralizes agent-written event handlers', async () => {
  const out = await loadRenderedHtml('<img src=x onerror="window.__TAURI__.core.invoke(\'kernel_shutdown\')">');
  assertSafe(out, 'sticky img onerror');
});

test('StickyNote renderedHtml neutralizes agent-written javascript links and keeps markdown', async () => {
  const out = await loadRenderedHtml('# 标题\n\n[点我](javascript:window.__TAURI__.core.invoke(\'kernel_shutdown\'))\n\n**正文**');
  assert.ok(out.includes('<h1'), 'heading kept');
  assert.ok(out.includes('正文') || out.includes('<strong'), 'normal markdown kept');
  assertSafe(out, 'sticky javascript link');
});

test('StickyNote renderedHtml keeps agent-written LaTeX', async () => {
  const out = await loadRenderedHtml('Agent 数学 $E=mc^2$');
  assert.ok(out.includes('class="katex"'), 'latex kept');
  assertSafe(out, 'sticky latex');
});
