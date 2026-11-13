import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// 测试纯领域逻辑与算法（HistoryManager 与 LaserPointerManager）
class InkHistoryManager {
  constructor(initialStrokes = []) {
    this.undoStack = [...initialStrokes];
    this.redoStack = [];
  }

  get strokes() {
    return this.undoStack;
  }

  push(stroke) {
    this.undoStack.push(stroke);
    this.redoStack = [];
  }

  undo() {
    const stroke = this.undoStack.pop();
    if (stroke) {
      this.redoStack.push(stroke);
      return stroke;
    }
    return null;
  }

  redo() {
    const stroke = this.redoStack.pop();
    if (stroke) {
      this.undoStack.push(stroke);
      return stroke;
    }
    return null;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }
}

class LaserPointerManager {
  constructor() {
    this.points = [];
    this.lifetimeMs = 2000;
  }

  addPoint(x, y, timestamp = Date.now()) {
    this.points.push({ x, y, pressure: 1.0, timestamp });
  }

  prune(now = Date.now()) {
    const cutoff = now - this.lifetimeMs;
    this.points = this.points.filter((p) => p.timestamp >= cutoff);
  }

  clear() {
    this.points = [];
  }

  get activePoints() {
    return this.points;
  }

  hasPoints() {
    return this.points.length > 0;
  }
}

test('InkHistoryManager maintains undo/redo stack properly', () => {
  const manager = new InkHistoryManager();
  assert.equal(manager.canUndo(), false);
  assert.equal(manager.canRedo(), false);
  assert.equal(manager.undo(), null);
  assert.equal(manager.redo(), null);

  const stroke1 = { id: 's1', tool: 'pen', color: '#ff0000', width: 4, points: [{ x: 10, y: 10, pressure: 0.5, timestamp: 100 }] };
  const stroke2 = { id: 's2', tool: 'highlighter', color: '#00ff00', width: 8, points: [{ x: 20, y: 20, pressure: 0.8, timestamp: 200 }] };

  manager.push(stroke1);
  assert.equal(manager.canUndo(), true);
  assert.equal(manager.canRedo(), false);
  assert.equal(manager.strokes.length, 1);

  manager.push(stroke2);
  assert.equal(manager.strokes.length, 2);

  // 撤销 stroke2
  const undone = manager.undo();
  assert.equal(undone.id, 's2');
  assert.equal(manager.strokes.length, 1);
  assert.equal(manager.canRedo(), true);

  // 重做 stroke2
  const redone = manager.redo();
  assert.equal(redone.id, 's2');
  assert.equal(manager.strokes.length, 2);
  assert.equal(manager.canRedo(), false);

  // 撤销后再 push 新笔画应清空重做栈
  manager.undo();
  const stroke3 = { id: 's3', tool: 'rect', color: '#0000ff', width: 2, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] };
  manager.push(stroke3);
  assert.equal(manager.strokes.length, 2);
  assert.equal(manager.canRedo(), false);
  assert.equal(manager.redo(), null);

  // 清空
  manager.clear();
  assert.equal(manager.strokes.length, 0);
  assert.equal(manager.canUndo(), false);
  assert.equal(manager.canRedo(), false);
});

test('LaserPointerManager automatically prunes points older than 2000ms', () => {
  const laser = new LaserPointerManager();
  const baseTime = 10000;

  laser.addPoint(100, 100, baseTime);
  laser.addPoint(120, 120, baseTime + 500);
  laser.addPoint(150, 150, baseTime + 1500);

  assert.equal(laser.hasPoints(), true);
  assert.equal(laser.activePoints.length, 3);

  // 1000ms 过去（未超过 2000ms 寿命）
  laser.prune(baseTime + 1000);
  assert.equal(laser.activePoints.length, 3);

  // 2100ms 过去（第 1 个点超过 2000ms，被裁切）
  laser.prune(baseTime + 2100);
  assert.equal(laser.activePoints.length, 2);
  assert.equal(laser.activePoints[0].x, 120);

  // 4000ms 过去（所有点均已超过 2000ms 消隐时间）
  laser.prune(baseTime + 4000);
  assert.equal(laser.hasPoints(), false);
  assert.equal(laser.activePoints.length, 0);
});

/* ==================== A3 Agent UI 握手：ScreenInkCanvas draw / snapshot / clear ==================== */

const inkSource = await readFile(new URL('../../src/utils/ink.ts', import.meta.url), 'utf8');
const canvasComponentSource = await readFile(new URL('../../src/components/ScreenInkCanvas.vue', import.meta.url), 'utf8');

function compileInto(code, context) {
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
}

function makeRecordingCtx(log) {
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => { log.push({ name: String(prop), args }); };
    },
    set(target, prop, value) {
      target[prop] = value;
      log.push({ name: String(prop), args: [value] });
      return true;
    },
  });
}

function makeFakeCanvas(options = {}) {
  const log = [];
  return {
    width: 0,
    height: 0,
    style: {},
    log,
    getContext: () => makeRecordingCtx(log),
    toDataURL: () => options.snapshotDataUrl ?? 'data:image/png;base64,QUJDRA==',
  };
}

async function loadInkCanvas(options = {}) {
  const scriptMatch = canvasComponentSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'must load the actual ScreenInkCanvas script');
  const script = scriptMatch[1].replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');

  const calls = [];
  const listeners = [];
  const disposed = [];
  const hooks = { mounted: [], unmounted: [] };
  const broadcastInstances = [];
  const mainCanvas = makeFakeCanvas();
  let snapshotCanvas = makeFakeCanvas({ snapshotDataUrl: options.snapshotDataUrl });

  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.sent = [];
      this.onmessage = null;
      broadcastInstances.push(this);
    }
    postMessage(data) { this.sent.push(data); }
    close() { this.closed = true; }
  }

  const windowFake = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    location: { search: '' },
    addEventListener() {},
    removeEventListener() {},
    __TAURI__: {
      event: {
        listen(name, callback) {
          listeners.push({ name, callback });
          return Promise.resolve(() => { disposed.push(name); });
        },
      },
    },
  };

  const context = vm.createContext({
    ref: (value) => ({ value }),
    nextTick: () => Promise.resolve(),
    onMounted(fn) { hooks.mounted.push(fn); },
    onUnmounted(fn) { hooks.unmounted.push(fn); },
    invokeIpc: async (name, payload = {}) => {
      calls.push({
        name,
        kind: payload.kind,
        operation: payload.operation,
        ok: payload.ok,
        error: payload.error,
        result: payload.result,
        args: { ...payload },
      });
      if (name === 'ink_get_status') {
        return { active_tool: 'pen', color: '#ef4444', stroke_width: 4, is_passthrough: false };
      }
      if (name === 'toolbox_agent_ui_ready') {
        return { session_id: options.agentSessionId ?? 'ink-session-1' };
      }
      if (name === 'toolbox_agent_ui_result') {
        return { acknowledged: true };
      }
      return {};
    },
    window: windowFake,
    document: { createElement: () => { snapshotCanvas = makeFakeCanvas({ snapshotDataUrl: options.snapshotDataUrl }); return snapshotCanvas; } },
    BroadcastChannel: FakeBroadcastChannel,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    console,
  });

  compileInto(inkSource.replace(/export /g, ''), context);
  compileInto(script, context);

  const run = (expression) => vm.runInContext(expression, context);
  windowFake.__mainCanvas = mainCanvas;
  run('canvasRef.value = window.__mainCanvas');

  return {
    run,
    calls,
    listeners,
    disposed,
    hooks,
    broadcastInstances,
    agentResultCalls: () => calls.filter((call) => call.name === 'toolbox_agent_ui_result'),
    dispatchAgent(payload) {
      const listener = listeners.find((item) => item.name === 'screen-ink://agent-command');
      assert.ok(listener, 'screen-ink://agent-command listener is registered');
      return listener.callback({ payload });
    },
  };
}

const INK_BOUNDS = { x: 0, y: 0, width: 800, height: 600, scale_factor: 1 };

test('mount registers the ink agent session with exact {kind:ink} args and the agent-command listener', async () => {
  const h = await loadInkCanvas();
  await h.hooks.mounted[0]();
  const ready = h.calls.find((call) => call.name === 'toolbox_agent_ui_ready');
  assert.ok(ready, 'toolbox_agent_ui_ready is invoked');
  assert.deepEqual(Object.keys(ready.args).sort(), ['kind'], 'ink ready args are exactly {kind}');
  assert.equal(ready.args.kind, 'ink');
  assert.ok(h.listeners.some((item) => item.name === 'screen-ink://agent-command'));
});

test('agent draw appends to the shared history and undo stack and acknowledges applied', async () => {
  const h = await loadInkCanvas();
  await h.hooks.mounted[0]();
  await h.dispatchAgent({
    request_id: 'd1', session_id: 'ink-session-1', operation: 'draw',
    canvas_bounds: INK_BOUNDS,
    strokes: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], color: '#112233', width: 3 }],
  });
  const drawResult = h.agentResultCalls().find((call) => call.operation === 'draw');
  assert.equal(drawResult.ok, true);
  assert.equal(drawResult.result.applied, 1);
  assert.deepEqual(Object.keys(drawResult.args).sort(), ['kind', 'ok', 'operation', 'request_id', 'result', 'session_id']);
  assert.equal(h.run('historyManager.strokes.length'), 1);
  assert.equal(h.run('historyManager.canUndo()'), true);
  assert.equal(h.run('historyManager.strokes[0].tool'), 'pen');
  assert.equal(h.run('historyManager.strokes[0].points[0].x'), 10);
  assert.equal(h.run('historyManager.strokes[0].points[0].y'), 20);
  // 同一历史/撤销栈：人用 undo 可撤销 Agent 笔画，重做栈一致
  h.run('historyManager.undo()');
  assert.equal(h.run('historyManager.strokes.length'), 0);
  assert.equal(h.run('historyManager.canRedo()'), true);
});

test('native-normalized logical strokes are not scaled twice on a negative-origin HiDPI canvas', async () => {
  const h = await loadInkCanvas();
  await h.hooks.mounted[0]();
  await h.dispatchAgent({
    request_id: 'd2', session_id: 'ink-session-1', operation: 'draw',
    canvas_bounds: { x: -1600, y: 0, width: 1600, height: 1200, scale_factor: 2 },
    strokes: [{ points: [{ x: 2, y: 2 }], color: '#112233', width: 2 }],
  });
  // 原生已将物理 (-1596,4)、线宽4转换为逻辑(2,2)、线宽2。
  assert.equal(h.run('historyManager.strokes[0].points[0].x'), 2);
  assert.equal(h.run('historyManager.strokes[0].points[0].y'), 2);
  assert.equal(h.run('historyManager.strokes[0].width'), 2);
});

test('an active user pointer stroke returns BUSY and never drops the user stroke', async () => {
  const h = await loadInkCanvas();
  await h.hooks.mounted[0]();
  h.run('isDrawing = true; currentPoints = [{ x: 5, y: 5, pressure: 0.5, timestamp: 0 }]');
  await h.dispatchAgent({
    request_id: 'b1', session_id: 'ink-session-1', operation: 'draw',
    canvas_bounds: INK_BOUNDS,
    strokes: [{ points: [{ x: 1, y: 1 }], color: '#000000', width: 2 }],
  });
  const busy = h.agentResultCalls().find((call) => call.operation === 'draw');
  assert.equal(busy.ok, false);
  assert.equal(busy.error, 'BUSY');
  assert.equal(h.run('historyManager.strokes.length'), 0);
  assert.equal(h.run('currentPoints.length'), 1, 'the active user stroke is preserved');
});

test('agent clear uses the same history and acknowledges completion', async () => {
  const h = await loadInkCanvas();
  await h.hooks.mounted[0]();
  await h.dispatchAgent({
    request_id: 'd3', session_id: 'ink-session-1', operation: 'draw',
    canvas_bounds: INK_BOUNDS,
    strokes: [{ points: [{ x: 10, y: 10 }], color: '#112233', width: 3 }],
  });
  assert.equal(h.run('historyManager.strokes.length'), 1);
  await h.dispatchAgent({ request_id: 'c1', session_id: 'ink-session-1', operation: 'clear', canvas_bounds: INK_BOUNDS });
  assert.equal(h.run('historyManager.strokes.length'), 0);
  const clearResult = h.agentResultCalls().find((call) => call.operation === 'clear');
  assert.equal(clearResult.ok, true);
  assert.equal(h.run('historyManager.canUndo()'), false);
});

test('agent snapshot returns the real transparent canvas PNG with bounded base64 and dimensions', async () => {
  const h = await loadInkCanvas({ snapshotDataUrl: 'data:image/png;base64,QUJDRA==' });
  await h.hooks.mounted[0]();
  await h.dispatchAgent({
    request_id: 'd4', session_id: 'ink-session-1', operation: 'draw',
    canvas_bounds: INK_BOUNDS,
    strokes: [{ points: [{ x: 10, y: 10 }], color: '#112233', width: 3 }],
  });
  await h.dispatchAgent({ request_id: 's1', session_id: 'ink-session-1', operation: 'snapshot', canvas_bounds: INK_BOUNDS });
  const snap = h.agentResultCalls().find((call) => call.operation === 'snapshot');
  assert.equal(snap.ok, true);
  assert.equal(snap.result.png_base64, 'QUJDRA==');
  assert.equal(String(snap.result.png_base64).startsWith('data:'), false, 'base64 carries no data URL prefix');
  assert.equal(snap.result.width, 800);
  assert.equal(snap.result.height, 600);
});

test('wrong-session and duplicate agent commands never commit or double-ack', async () => {
  const h = await loadInkCanvas();
  await h.hooks.mounted[0]();
  await h.dispatchAgent({
    request_id: 'x1', session_id: 'other-session', operation: 'draw',
    canvas_bounds: INK_BOUNDS,
    strokes: [{ points: [{ x: 1, y: 1 }], color: '#000000', width: 2 }],
  });
  assert.equal(h.agentResultCalls().length, 0, 'foreign sessions are not claimed');
  assert.equal(h.run('historyManager.strokes.length'), 0);
  await h.dispatchAgent({
    request_id: 'dup', session_id: 'ink-session-1', operation: 'draw',
    canvas_bounds: INK_BOUNDS,
    strokes: [{ points: [{ x: 2, y: 2 }], color: '#000000', width: 2 }],
  });
  assert.equal(h.agentResultCalls().length, 1);
  await h.dispatchAgent({
    request_id: 'dup', session_id: 'ink-session-1', operation: 'draw',
    canvas_bounds: INK_BOUNDS,
    strokes: [{ points: [{ x: 3, y: 3 }], color: '#000000', width: 2 }],
  });
  assert.equal(h.agentResultCalls().length, 1, 'duplicate request ids complete only once');
  assert.equal(h.run('historyManager.strokes.length'), 1, 'duplicate draw never commits twice');
});

test('unmount removes the agent listener and keeps cleanup bounded', async () => {
  const h = await loadInkCanvas();
  await h.hooks.mounted[0]();
  for (const fn of h.hooks.unmounted) fn();
  assert.ok(h.disposed.includes('screen-ink://agent-command'), 'agent listener is disposed on unmount');
});
