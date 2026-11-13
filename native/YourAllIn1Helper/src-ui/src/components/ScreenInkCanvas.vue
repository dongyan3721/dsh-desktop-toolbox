<template>
  <div class="screen-ink-canvas-root" :class="{ 'cursor-crosshair': currentTool !== 'eraser' && currentTool !== 'laser', 'cursor-eraser': currentTool === 'eraser', 'cursor-laser': currentTool === 'laser' }">
    <canvas
      ref="canvasRef"
      class="ink-canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    ></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import {
  type InkTool,
  type InkPoint,
  type InkStroke,
  InkHistoryManager,
  LaserPointerManager,
  renderStroke,
} from '../utils/ink';
import { invokeIpc } from '../api/ipc';

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

// 当前绘图设置
const currentTool = ref<InkTool>('pen');
const currentColor = ref<string>('#ef4444');
const currentWidth = ref<number>(4);
const canvasPassthrough = ref(false);

// 历史记录与激光笔管理器
const historyManager = new InkHistoryManager();
const laserManager = new LaserPointerManager();

// 当前活跃笔画
let isDrawing = false;
let currentPoints: InkPoint[] = [];
let animFrameId: number | null = null;

// 与独立工具栏双向通信的跨窗口广播通道
let broadcastChannel: BroadcastChannel | null = null;
let unlistenClear: (() => void) | null = null;
let unlistenMode: (() => void) | null = null;

onMounted(async () => {
  initCanvas();
  window.addEventListener('resize', onResize);

  // 初始化同源广播信道（保证透明画布与独立工具栏零网络毫秒级同步）
  broadcastChannel = new BroadcastChannel('screen-ink-channel');
  broadcastChannel.onmessage = (event) => {
    handleToolbarMessage(event.data);
  };

  // 先读取已生效的模块配置，避免默认 pen/red 覆盖工具栏的自定义初始状态。
  try {
    const status = await invokeIpc<{
      active_tool: InkTool;
      color: string;
      stroke_width: number;
      is_passthrough: boolean;
    }>('ink_get_status');
    currentTool.value = status.active_tool;
    currentColor.value = status.color;
    currentWidth.value = status.stroke_width;
    canvasPassthrough.value = status.is_passthrough;
  } catch (_) {}
  // 通知工具栏画布已就绪
  notifyToolbar();
  void applyNativeCursor();

  // 监听原生 Tauri 事件总线（支持快捷键或主控台直接触发清屏/穿透）
  const tauriListen = (window as any).__TAURI__?.event?.listen;
  if (typeof tauriListen === 'function') {
    try {
      unlistenClear = await tauriListen('screen-ink://clear-canvas', () => {
        historyManager.clear();
        laserManager.clear();
        redrawAll();
        notifyToolbar();
      });
      unlistenMode = await tauriListen('screen-ink://mode-changed', (event: { payload?: { is_passthrough?: boolean } }) => {
        if (typeof event?.payload?.is_passthrough === 'boolean') {
          canvasPassthrough.value = event.payload.is_passthrough;
        }
        notifyToolbar();
        void applyNativeCursor();
      });
      unlistenAgentCommand = await tauriListen('screen-ink://agent-command', (event: { payload?: Record<string, unknown> }) => {
        const payload = event?.payload;
        if (payload && typeof payload === 'object') {
          return handleAgentCommand(payload);
        }
        return undefined;
      });
    } catch (_) {}
  }
  await registerAgentInkSession();
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
  }
  if (broadcastChannel) {
    broadcastChannel.close();
  }
  if (unlistenClear) {
    unlistenClear();
    unlistenClear = null;
  }
  if (unlistenMode) {
    unlistenMode();
    unlistenMode = null;
  }
  if (unlistenAgentCommand) {
    unlistenAgentCommand();
    unlistenAgentCommand = null;
  }
});

function initCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
  }
  redrawAll();
}

function onResize() {
  initCanvas();
}

/** 处理工具栏发送的控制指令 */
async function handleToolbarMessage(data: any) {
  if (!data || !data.type) return;

  switch (data.type) {
    case 'set_tool':
      currentTool.value = data.tool;
      void applyNativeCursor();
      break;
    case 'set_color':
      currentColor.value = data.color;
      break;
    case 'set_width':
      currentWidth.value = data.width;
      break;
    case 'undo':
      historyManager.undo();
      redrawAll();
      notifyToolbar();
      break;
    case 'redo':
      historyManager.redo();
      redrawAll();
      notifyToolbar();
      break;
    case 'clear':
      historyManager.clear();
      laserManager.clear();
      redrawAll();
      notifyToolbar();
      break;
    case 'request_state_sync':
      notifyToolbar();
      break;
    case 'request_snapshot':
      await handleExportSnapshot(data.copyToClipboard);
      break;
  }
}

/** 穿透用箭头；橡皮是单元格光标，激光笔隐藏，其余绘制工具用十字。 */
function cursorShape(): 'arrow' | 'crosshair' | 'cell' | 'none' {
  if (canvasPassthrough.value) return 'arrow';
  if (currentTool.value === 'eraser') return 'cell';
  if (currentTool.value === 'laser') return 'none';
  return 'crosshair';
}

/**
 * CSS cursor 只在下一次鼠标事件里生效。等 DOM 类名落地后再让宿主立刻设置 NSCursor，
 * 这样切换穿透或工具时，停在画布上的指针不用再点一下空白处。
 */
async function applyNativeCursor() {
  await nextTick();
  const shape = cursorShape();
  try {
    await invokeIpc('ink_apply_cursor', { shape });
  } catch (_) {}
}

function notifyToolbar() {
  if (!broadcastChannel) return;
  broadcastChannel.postMessage({
    type: 'state_sync',
    canUndo: historyManager.canUndo(),
    canRedo: historyManager.canRedo(),
    tool: currentTool.value,
    color: currentColor.value,
    width: currentWidth.value,
  });
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return; // 仅响应主按键
  isDrawing = true;
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);

  const pt: InkPoint = {
    x: e.clientX,
    y: e.clientY,
    pressure: e.pressure > 0 ? e.pressure : 0.5,
    timestamp: Date.now(),
  };

  currentPoints = [pt];

  if (currentTool.value === 'laser') {
    laserManager.addPoint(pt.x, pt.y);
    startLaserLoop();
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isDrawing) return;

  const pt: InkPoint = {
    x: e.clientX,
    y: e.clientY,
    pressure: e.pressure > 0 ? e.pressure : 0.5,
    timestamp: Date.now(),
  };

  currentPoints.push(pt);

  if (currentTool.value === 'laser') {
    laserManager.addPoint(pt.x, pt.y);
    startLaserLoop();
    return;
  }

  // 几何图形与实时笔画绘制
  if (['line', 'rect', 'arrow'].includes(currentTool.value)) {
    redrawAll();
    if (ctx) {
      renderStroke(ctx, {
        id: 'preview',
        tool: currentTool.value,
        color: currentColor.value,
        width: currentWidth.value,
        points: [currentPoints[0], pt],
      });
    }
  } else {
    // 自由笔画（pen, highlighter, eraser）
    if (ctx) {
      const segLen = currentPoints.length;
      if (segLen >= 2) {
        renderStroke(ctx, {
          id: 'incremental',
          tool: currentTool.value,
          color: currentColor.value,
          width: currentWidth.value,
          points: currentPoints.slice(segLen - 3 > 0 ? segLen - 3 : 0),
        });
      }
    }
  }
}

function onPointerUp(e: PointerEvent) {
  if (!isDrawing) return;
  isDrawing = false;
  const target = e.currentTarget as HTMLElement;
  try {
    target.releasePointerCapture(e.pointerId);
  } catch (_) {}

  if (currentTool.value === 'laser') {
    currentPoints = [];
    return;
  }

  if (currentPoints.length > 0) {
    const newStroke: InkStroke = {
      id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tool: currentTool.value,
      color: currentColor.value,
      width: currentWidth.value,
      points: [...currentPoints],
    };
    historyManager.push(newStroke);
    redrawAll();
    notifyToolbar();
  }
  currentPoints = [];
}

/** 全量重绘画布所有已有笔画 */
function redrawAll() {
  const canvas = canvasRef.value;
  if (!canvas || !ctx) return;

  // 清空全屏像素
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // 顺序绘制所有历史笔画
  for (const stroke of historyManager.strokes) {
    renderStroke(ctx, stroke);
  }
}

/** 激光笔消隐渐变循环渲染 */
function startLaserLoop() {
  if (animFrameId !== null) return;

  const loop = () => {
    if (!laserManager.hasPoints()) {
      animFrameId = null;
      redrawAll();
      return;
    }

    redrawAll();
    if (ctx) {
      laserManager.render(ctx, currentColor.value, Date.now());
    }
    animFrameId = requestAnimationFrame(loop);
  };

  animFrameId = requestAnimationFrame(loop);
}

/** 导出当前墨迹透明 PNG 并调用微内核真实合成落盘/复制到剪贴板 */
async function handleExportSnapshot(copyToClipboard: boolean = true) {
  const canvas = canvasRef.value;
  if (!canvas) return;

  // 临时导出仅包含有效墨迹的透明 PNG（不含激光笔临时亮点）
  const offscreen = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  offscreen.width = w * dpr;
  offscreen.height = h * dpr;
  const offCtx = offscreen.getContext('2d');
  if (offCtx) {
    offCtx.scale(dpr, dpr);
    for (const stroke of historyManager.strokes) {
      renderStroke(offCtx, stroke);
    }
  }

  const inkPngDataUrl = offscreen.toDataURL('image/png');

  try {
    const res = await invokeIpc<{
      saved_path?: string;
      copied_to_clipboard: boolean;
      clipboard_error?: string;
    }>('ink_save_snapshot', {
      ink_png_base64: inkPngDataUrl,
      copy_to_clipboard: copyToClipboard,
    });

    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: 'snapshot_result',
        success: true,
        savedPath: res.saved_path,
        copiedToClipboard: res.copied_to_clipboard,
        clipboardError: res.clipboard_error,
      });
    }
  } catch (err: any) {
    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: 'snapshot_result',
        success: false,
        error: err.message || '截图合成保存失败',
      });
    }
  }
}

/* ==================== A3 Agent UI 握手（原画布执行，同一历史/撤销栈） ==================== */
const AGENT_MAX_STROKES = 128;
const AGENT_MAX_POINTS = 8192;
/** 16MiB PNG 对应的 base64 长度上限（有界结果） */
const AGENT_MAX_PNG_BASE64_CHARS = 22369624;

let agentSessionId: string | null = null;
let agentHandshakeDead = false;
let unlistenAgentCommand: (() => void) | null = null;
let agentCommandTail: Promise<void> = Promise.resolve();
const agentBuffer: Array<{ payload: Record<string, unknown>; resolve: () => void }> = [];
/** 每个 request_id 只允许一次完成回复；迟到/重复回复不重复提交 */
const handledAgentRequests = new Set<string>();

interface AgentCanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

async function reportInkResult(
  payload: { request_id: string; session_id: string; operation: string },
  ok: boolean,
  result: Record<string, unknown>,
  error?: 'BUSY' | 'CONFLICT',
) {
  const args: Record<string, unknown> = {
    kind: 'ink',
    request_id: payload.request_id,
    session_id: payload.session_id,
    operation: payload.operation,
    ok,
    result,
  };
  if (error) args.error = error;
  try {
    await invokeIpc('toolbox_agent_ui_result', args);
  } catch (_) {}
}

async function registerAgentInkSession() {
  try {
    // 契约：ink 会话 args 精确为 {kind:'ink'}，不得携带 note_id
    const res = await invokeIpc<{ session_id?: string }>('toolbox_agent_ui_ready', { kind: 'ink' });
    const sessionId = typeof res?.session_id === 'string' ? res.session_id : '';
    if (!sessionId) throw new Error('ink agent session invalid');
    agentSessionId = sessionId;
    const buffered = agentBuffer.splice(0, agentBuffer.length);
    for (const item of buffered) {
      const run = () => processAgentCommand(item.payload).then(item.resolve, item.resolve);
      agentCommandTail = agentCommandTail.then(run, run);
    }
  } catch (_) {
    agentHandshakeDead = true;
    const buffered = agentBuffer.splice(0, agentBuffer.length);
    for (const item of buffered) item.resolve();
  }
}

function handleAgentCommand(payload: Record<string, unknown>): Promise<void> {
  if (agentHandshakeDead) return Promise.resolve();
  if (agentSessionId == null) {
    if (agentBuffer.length >= 8) return Promise.resolve();
    return new Promise((resolve) => {
      agentBuffer.push({ payload, resolve });
    });
  }
  const run = () => processAgentCommand(payload);
  const next = agentCommandTail.then(run, run);
  agentCommandTail = next.then(() => undefined, () => undefined);
  return next;
}

function agentCanvasBounds(payload: Record<string, unknown>): AgentCanvasBounds | null {
  const raw = payload.canvas_bounds as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  const scale = Number(raw.scale_factor);
  if (![x, y, width, height, scale].every((v) => Number.isFinite(v)) || width <= 0 || height <= 0 || scale <= 0) {
    return null;
  }
  return { x, y, width, height, scale };
}

function makeAgentStroke(points: InkPoint[], color: string, width: number): InkStroke {
  return {
    id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    tool: 'pen',
    color,
    width,
    points,
  };
}

/**
 * 原生统一把点与线宽转换为逻辑像素；前端只校验，不猜测/再次缩放。
 */
function normalizeAgentStroke(raw: unknown, bounds: AgentCanvasBounds): InkStroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const rawPoints = Array.isArray(record.points) ? record.points : [];
  if (rawPoints.length === 0) return null;
  const width = Number(record.width);
  const color = typeof record.color === 'string' && record.color.length <= 32 ? record.color : '#000000';
  const asLogical: InkPoint[] = [];
  for (const p of rawPoints) {
    const point = p as Record<string, unknown> | null;
    const px = Number(point?.x);
    const py = Number(point?.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    asLogical.push({ x: px, y: py, pressure: 0.5, timestamp: Date.now() });
  }
  const logicalW = bounds.width / bounds.scale;
  const logicalH = bounds.height / bounds.scale;
  const inside = (pt: InkPoint) => pt.x >= 0 && pt.y >= 0 && pt.x < logicalW && pt.y < logicalH;
  if (Number.isFinite(width) && width > 0 && asLogical.every(inside)) {
    return makeAgentStroke(asLogical, color, width);
  }
  return null;
}

function renderInkDataUrl(): { dataUrl: string; width: number; height: number } | null {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  // 仅包含有效墨迹的透明 PNG（不含激光笔临时亮点）
  const offscreen = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  offscreen.width = w * dpr;
  offscreen.height = h * dpr;
  const offCtx = offscreen.getContext('2d');
  if (offCtx) {
    offCtx.scale(dpr, dpr);
    for (const stroke of historyManager.strokes) {
      renderStroke(offCtx, stroke);
    }
  }
  return { dataUrl: offscreen.toDataURL('image/png'), width: offscreen.width, height: offscreen.height };
}

async function processAgentCommand(payload: Record<string, unknown>) {
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : '';
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const operation = typeof payload.operation === 'string' ? payload.operation : '';
  if (!requestId || !sessionId || !operation) return;
  // 异会话（旧实例/重注册前的迟到请求）不认领
  if (agentSessionId == null || sessionId !== agentSessionId) return;
  if (handledAgentRequests.has(requestId)) return;

  const ack = (ok: boolean, result: Record<string, unknown> = {}, error?: 'BUSY' | 'CONFLICT') => {
    handledAgentRequests.add(requestId);
    void reportInkResult({ request_id: requestId, session_id: sessionId, operation }, ok, result, error);
  };

  if (operation === 'draw') {
    // 用户正在画：返回 BUSY，绝不丢弃用户笔画
    if (isDrawing) {
      ack(false, {}, 'BUSY');
      return;
    }
    const bounds = agentCanvasBounds(payload);
    const rawStrokes = Array.isArray(payload.strokes) ? payload.strokes : [];
    if (!bounds || rawStrokes.length === 0 || rawStrokes.length > AGENT_MAX_STROKES) {
      ack(false);
      return;
    }
    let applied = 0;
    let pointsTotal = 0;
    for (const raw of rawStrokes) {
      const stroke = normalizeAgentStroke(raw, bounds);
      if (!stroke) continue;
      pointsTotal += stroke.points.length;
      if (pointsTotal > AGENT_MAX_POINTS) break;
      historyManager.push(stroke);
      applied += 1;
    }
    if (applied > 0) {
      redrawAll();
      notifyToolbar();
    }
    ack(true, { applied });
    return;
  }

  if (operation === 'clear') {
    if (isDrawing) {
      ack(false, {}, 'BUSY');
      return;
    }
    historyManager.clear();
    laserManager.clear();
    redrawAll();
    notifyToolbar();
    ack(true);
    return;
  }

  if (operation === 'snapshot') {
    const rendered = renderInkDataUrl();
    if (!rendered) {
      ack(false);
      return;
    }
    const comma = rendered.dataUrl.indexOf(',');
    const base64 = comma >= 0 ? rendered.dataUrl.slice(comma + 1) : rendered.dataUrl;
    if (!base64 || base64.length > AGENT_MAX_PNG_BASE64_CHARS) {
      ack(false);
      return;
    }
    ack(true, { png_base64: base64, width: rendered.width, height: rendered.height });
    return;
  }

  ack(false);
}
</script>

<style scoped>
.screen-ink-canvas-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  background: transparent !important;
  overflow: hidden;
  user-select: none;
  touch-action: none;
}

.ink-canvas {
  display: block;
  width: 100vw;
  height: 100vh;
  background: transparent !important;
}

.cursor-crosshair {
  cursor: crosshair;
}

.cursor-eraser {
  cursor: cell;
}

.cursor-laser {
  cursor: none;
}
</style>
