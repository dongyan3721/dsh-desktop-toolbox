/**
 * ModuleManager (A3 五项授权、统一竞态与旧 props 防护) 独立单元测试
 * 覆盖：
 * 1. 以原生 catalog agent_supported 为支持依据（缺字段保守 false），支持名单共五项；伪造标记仍被白名单拦截
 * 2. 4 种开关状态组合（开启/关闭 × 授权/未授权）及未开启功能时的暂不生效提示
 * 3. 共享范围文案（含便笺）与三语言键值完整性
 * 4. 成功调用与权威 catalog 返回更新
 * 5. 失败回滚与错误提示呈现
 * 6. 人用开关与 Agent 开关的按模块独立 pending 与跨模块并发非阻塞
 * 7. 两类开关/跨模块反序响应不得整份覆盖较新 catalog
 * 8. 旧 props 重载不得回退较新状态；未见过的外部 catalog 仍被接受
 * 9. 整份权威状态落地后跳过失败回滚，未落地时正常回滚
 * 10. 键盘可达性与 a11y 属性规范 (role="switch", aria-checked, aria-label, aria-busy, focus-visible)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const featuresSource = await readFile(new URL('../../src/utils/features.ts', import.meta.url), 'utf8');
const componentSource = await readFile(new URL('../../src/components/ModuleManager.vue', import.meta.url), 'utf8');

function compile(code, context) {
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
}

const zhLocales = JSON.parse(await readFile(new URL('../../src/locales/zh-CN.json', import.meta.url), 'utf8'));

function t(key, params = {}) {
  const parts = key.split('.');
  let cur = zhLocales;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = cur[p];
    else return key;
  }
  if (typeof cur !== 'string') return key;
  return cur.replace(/\{(\w+)\}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);
}

async function moduleManagerHarness(initialModules, invoke) {
  const scriptMatch = componentSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error('Cannot extract script from ModuleManager.vue');
  const script = scriptMatch[1].replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');

  const emits = [];
  const watchers = [];
  // defineProps 返回值与全局 props 必须是同一对象，reloadProps 才能真正驱动 watcher
  const propsObject = { modules: initialModules };

  const context = vm.createContext({
    ref: (value) => {
      let v = value;
      return {
        get value() { return v; },
        set value(next) { v = next; }
      };
    },
    computed: (fn) => ({
      get value() { return fn(); }
    }),
    watch: (getter, callback, options) => {
      watchers.push({ getter, callback });
      if (options?.immediate) {
        callback(getter());
      }
    },
    defineProps: () => propsObject,
    defineEmits: () => (event, ...args) => emits.push({ event, args }),
    invokeIpc: invoke,
    t,
    props: propsObject,
    JSON,
    Array,
    Set,
    Map,
    Boolean,
    Error,
    String,
  });

  compile(featuresSource.replace(/export /g, ''), context);
  compile(script, context);

  return {
    run: (expr) => vm.runInContext(expr, context),
    emits,
    context,
    /** 模拟父组件重新下发 props 并触发 watcher（旧 props 重载/新外部 catalog） */
    reloadProps(nextModules) {
      context.props.modules = nextModules;
      for (const watcher of watchers) watcher.callback(watcher.getter());
    },
  };
}

const mockCatalog = [
  { number: 1, id: 'screenshot', name: '增强截图', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: false, agent_effective: false },
  { number: 2, id: 'clipboard', name: '剪贴板', available: true, enabled: false, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: true, agent_effective: false },
  { number: 3, id: 'screen_ink', name: '屏幕注释', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: true, agent_effective: true },
  { number: 4, id: 'app_usage', name: '使用时长', available: true, enabled: false, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: false, agent_effective: false },
  { number: 5, id: 'sticky_note', name: '桌面便笺', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: false, agent_effective: false },
  { number: 6, id: 'translator', name: '划词翻译', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 7, id: 'password_vault', name: '密码本', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 8, id: 'media_proc', name: '媒体处理', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 9, id: 'script_runner', name: '脚本执行', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 10, id: 'window_pin', name: '窗口置顶', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
];

function cloneCatalog(catalog = mockCatalog) {
  return JSON.parse(JSON.stringify(catalog));
}

test('A3 contract: exactly five modules are agent_supported via the native catalog; missing flag is conservatively false; forged flags stay blocked', async () => {
  const harness = await moduleManagerHarness(mockCatalog, async () => []);
  const { run } = harness;

  const supportedIds = ['screenshot', 'clipboard', 'screen_ink', 'app_usage', 'sticky_note'];
  const unsupportedIds = ['translator', 'password_vault', 'media_proc', 'script_runner', 'window_pin'];

  for (const id of supportedIds) {
    const mod = mockCatalog.find(m => m.id === id);
    assert.equal(run(`isAgentSupported(${JSON.stringify(mod)})`), true, `${id} must be agent supported`);
    const scope = run(`getAgentScopeText('${id}')`);
    assert.ok(scope.length > 0, `${id} must have non-empty shared scope text`);
  }

  for (const id of unsupportedIds) {
    const mod = mockCatalog.find(m => m.id === id);
    assert.equal(run(`isAgentSupported(${JSON.stringify(mod)})`), false, `${id} must NOT be agent supported`);
    const forged = { ...mod, agent_supported: true };
    assert.equal(run(`isAgentSupported(${JSON.stringify(forged)})`), false, `${id} with forged flag must remain unsupported`);
    assert.equal(run(`formatAgentStatus(${JSON.stringify(mod)})`), '不支持 Agent');
  }

  // 缺字段保守 false：没有 agent_supported 字段时不回退白名单
  const missingFlag = { ...mockCatalog.find(m => m.id === 'screenshot') };
  delete missingFlag.agent_supported;
  assert.equal(run(`isAgentSupported(${JSON.stringify(missingFlag)})`), false, 'missing agent_supported must be false');

  // 未知模块即使伪造 true 也不授权
  const unknown = { id: 'mystery', name: 'M', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: true };
  assert.equal(run(`isAgentSupported(${JSON.stringify(unknown)})`), false, 'unknown module must never be agent supported');
});

test('agentScope.sticky_note text exists and is non-empty in all three locales', async () => {
  for (const file of ['zh-CN.json', 'en-US.json', 'ja-JP.json']) {
    const locales = JSON.parse(await readFile(new URL(`../../src/locales/${file}`, import.meta.url), 'utf8'));
    const scope = locales?.moduleManager?.agentScope?.sticky_note;
    assert.equal(typeof scope, 'string', `${file} must define moduleManager.agentScope.sticky_note`);
    assert.ok(scope.trim().length > 0, `${file} moduleManager.agentScope.sticky_note must be non-empty`);
  }
});

test('A2 four combinations of human enabled and agent allowed states', async () => {
  const harness = await moduleManagerHarness(mockCatalog, async () => []);
  const { run } = harness;

  const c1 = mockCatalog.find(m => m.id === 'screenshot');
  assert.equal(run(`formatModuleStatus(${JSON.stringify(c1)})`), '已开启');
  assert.equal(run(`formatAgentStatus(${JSON.stringify(c1)})`), '已关闭');

  const c2 = mockCatalog.find(m => m.id === 'clipboard');
  assert.equal(run(`formatModuleStatus(${JSON.stringify(c2)})`), '已关闭');
  assert.equal(run(`formatAgentStatus(${JSON.stringify(c2)})`), '功能未开启，Agent 访问暂不生效');

  const c3 = mockCatalog.find(m => m.id === 'screen_ink');
  assert.equal(run(`formatModuleStatus(${JSON.stringify(c3)})`), '已开启');
  assert.equal(run(`formatAgentStatus(${JSON.stringify(c3)})`), '已开启');

  const c4 = mockCatalog.find(m => m.id === 'app_usage');
  assert.equal(run(`formatModuleStatus(${JSON.stringify(c4)})`), '已关闭');
  assert.equal(run(`formatAgentStatus(${JSON.stringify(c4)})`), '已关闭');
});

test('toggleAgentAccess invokes kernel_set_agent_access and updates canonical catalog', async () => {
  const calls = [];
  const updatedCatalog = cloneCatalog().map(m => m.id === 'screenshot' ? { ...m, agent_allowed: true, agent_effective: true } : m);

  const harness = await moduleManagerHarness(mockCatalog, async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'kernel_set_agent_access') {
      return updatedCatalog;
    }
    throw new Error('unknown command');
  });

  const { run, emits } = harness;
  const mod = mockCatalog.find(m => m.id === 'screenshot');
  await run(`toggleAgentAccess(${JSON.stringify(mod)})`);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'kernel_set_agent_access');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), { module_id: 'screenshot', allowed: true });

  const target = run(`localModules.value.find(m => m.id === 'screenshot')`);
  assert.equal(target.agent_allowed, true);
  assert.equal(emits.some(e => e.event === 'changed'), true);
  assert.equal(run('error.value'), '');
  assert.equal(run('pendingAgent.value.size'), 0);
});

test('toggleAgentAccess rolls back optimistic state on IPC failure and reports error', async () => {
  const calls = [];
  const harness = await moduleManagerHarness(mockCatalog, async (cmd, args) => {
    calls.push({ cmd, args });
    throw new Error('agent grant failed by policy');
  });

  const { run, emits } = harness;
  const mod = mockCatalog.find(m => m.id === 'screenshot');
  await run(`toggleAgentAccess(${JSON.stringify(mod)})`);

  assert.equal(calls.length, 1);
  const target = run(`localModules.value.find(m => m.id === 'screenshot')`);
  assert.equal(target.agent_allowed, false, 'must rollback to previous false state');
  assert.equal(run('error.value'), 'agent grant failed by policy');
  assert.equal(run('pendingAgent.value.size'), 0);
  assert.equal(emits.some(e => e.event === 'changed'), true);
});

test('two switch kinds track per-module pending independently and cross-module toggles never clobber each other', async () => {
  const pendingPromises = [];
  const calls = [];
  const harness = await moduleManagerHarness(mockCatalog, (cmd, args) => {
    calls.push({ cmd, args });
    return new Promise((resolve) => pendingPromises.push({ cmd, args, resolve }));
  });

  const { run } = harness;
  const screenshot = mockCatalog.find(m => m.id === 'screenshot');
  const clipboard = mockCatalog.find(m => m.id === 'clipboard');

  // 同一模块两类开关并发
  const humanPromise = run(`toggleEnabled(${JSON.stringify(screenshot)})`);
  // 跨模块：另一个模块的人用开关并发
  const crossPromise = run(`toggleEnabled(${JSON.stringify(clipboard)})`);
  // 同一模块的 Agent 开关并发
  const agentPromise = run(`toggleAgentAccess(${JSON.stringify(screenshot)})`);

  assert.equal(run(`pendingHuman.value.has('screenshot')`), true);
  assert.equal(run(`pendingHuman.value.has('clipboard')`), true);
  assert.equal(run(`pendingAgent.value.has('screenshot')`), true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].cmd, 'kernel_set_module_enabled');
  assert.equal(calls[1].cmd, 'kernel_set_module_enabled');
  assert.equal(calls[2].cmd, 'kernel_set_agent_access');

  // 反序完成：先清 agent、再清 clipboard、最后 screenshot human
  pendingPromises[2].resolve(mockCatalog);
  await agentPromise;
  assert.equal(run(`pendingAgent.value.has('screenshot')`), false, 'agent pending clears with its own resolution');
  assert.equal(run(`pendingHuman.value.has('screenshot')`), true, 'human pending must remain until its own resolution');
  assert.equal(run(`pendingHuman.value.has('clipboard')`), true, 'cross-module pending must remain');

  pendingPromises[1].resolve(mockCatalog);
  await crossPromise;
  assert.equal(run(`pendingHuman.value.has('clipboard')`), false);

  pendingPromises[0].resolve(mockCatalog);
  await humanPromise;
  assert.equal(run('pendingHuman.value.size'), 0);
});

test('out-of-order responses cannot overwrite a newer full catalog across switch kinds and modules', async () => {
  const pending = [];
  const harness = await moduleManagerHarness(mockCatalog, (cmd, args) => {
    return new Promise((resolve) => pending.push({ cmd, args, resolve }));
  });

  const { run } = harness;
  const screenshot = mockCatalog.find(m => m.id === 'screenshot');
  const clipboard = mockCatalog.find(m => m.id === 'clipboard');

  // 先发人用开关（seq 1），再发 Agent 开关（seq 2）
  const humanPromise = run(`toggleEnabled(${JSON.stringify(screenshot)})`);
  const agentPromise = run(`toggleAgentAccess(${JSON.stringify(clipboard)})`);

  // 新响应（seq 2）先返回：两个变更都已入库（screenshot.enabled=false、clipboard.agent_allowed=false）
  const newerCatalog = cloneCatalog().map(m => {
    if (m.id === 'screenshot') return { ...m, enabled: false };
    if (m.id === 'clipboard') return { ...m, agent_allowed: false, agent_effective: false };
    return m;
  });
  pending[1].resolve(newerCatalog);
  await agentPromise;
  assert.equal(run(`localModules.value.find(m => m.id === 'clipboard').agent_allowed`), false);

  // 旧响应（seq 1）后到：整份 catalog 停留在旧授权状态，必须整体丢弃，不得覆盖
  const olderCatalog = cloneCatalog().map(m => m.id === 'screenshot' ? { ...m, enabled: false } : m);
  pending[0].resolve(olderCatalog);
  await humanPromise;

  assert.equal(run(`localModules.value.find(m => m.id === 'clipboard').agent_allowed`), false, 'stale response must not restore the older agent grant');
  assert.equal(run(`localModules.value.find(m => m.id === 'screenshot').enabled`), false);
});

test('old props reload cannot regress newer local state while unseen external catalogs still apply', async () => {
  const harness = await moduleManagerHarness(mockCatalog, async () => []);
  const { run, reloadProps } = harness;

  // 初始 props 已应用
  assert.equal(run(`localModules.value.find(m => m.id === 'screenshot').agent_allowed`), false);

  // 更新的外部 catalog（未见过）：接受
  const external = cloneCatalog().map(m => m.id === 'screenshot' ? { ...m, agent_allowed: true, agent_effective: true } : m);
  reloadProps(external);
  assert.equal(run(`localModules.value.find(m => m.id === 'screenshot').agent_allowed`), true, 'fresh external catalog must apply');

  // 旧 props 重载（初始快照重放）：忽略，保留较新状态
  reloadProps(cloneCatalog());
  assert.equal(run(`localModules.value.find(m => m.id === 'screenshot').agent_allowed`), true, 'stale props reload must not regress');

  // 另一份未见过的新外部 catalog（基于当前外部状态继续演进）：接受
  const newerExternal = external.map(m => m.id === 'sticky_note' ? { ...m, agent_allowed: true } : m);
  reloadProps(newerExternal);
  assert.equal(run(`localModules.value.find(m => m.id === 'sticky_note').agent_allowed`), true);
  assert.equal(run(`localModules.value.find(m => m.id === 'screenshot').agent_allowed`), true);
});

test('failure rollback is skipped after a newer full catalog lands, and still runs when nothing intervened', async () => {
  const pending = [];
  const harness = await moduleManagerHarness(mockCatalog, (cmd, args) => {
    return new Promise((resolve, reject) => pending.push({ cmd, args, resolve, reject }));
  });

  const { run, reloadProps } = harness;
  const screenshot = mockCatalog.find(m => m.id === 'screenshot');

  // 情形 A：失败前有整份权威状态落地（外部 catalog 回显乐观值）→ 不回滚
  const humanPromise = run(`toggleEnabled(${JSON.stringify(screenshot)})`);
  assert.equal(run(`localModules.value.find(m => m.id === 'screenshot').enabled`), false, 'optimistic flip applies');
  const echoed = cloneCatalog().map(m => m.id === 'screenshot' ? { ...m, enabled: false } : m);
  reloadProps(echoed);
  pending[0].reject(new Error('transient failure'));
  await humanPromise;
  assert.equal(run(`localModules.value.find(m => m.id === 'screenshot').enabled`), false, 'rollback must be skipped after authoritative full state');
  assert.equal(run('error.value'), 'transient failure');

  // 情形 B：无任何整份状态介入 → 正常回滚
  const second = run(`toggleEnabled(${JSON.stringify(run('localModules.value.find(m => m.id === "app_usage")'))})`);
  assert.equal(run(`localModules.value.find(m => m.id === 'app_usage').enabled`), true, 'optimistic flip applies');
  pending[1].reject(new Error('second failure'));
  await second;
  assert.equal(run(`localModules.value.find(m => m.id === 'app_usage').enabled`), false, 'rollback must restore the previous state');
});

test('accessibility and template standards: role=switch, aria-checked, aria-label, aria-busy, focus-visible', () => {
  assert.ok(componentSource.includes('role="switch"'), 'Must define role=switch for accessibility');
  assert.ok(componentSource.includes(':aria-checked="module.enabled"'), 'Human switch must bind aria-checked');
  assert.ok(componentSource.includes(':aria-checked="Boolean(module.agent_allowed)"'), 'Agent switch must bind aria-checked');
  assert.ok(componentSource.includes(':aria-label="t(\'moduleManager.switchAria\','), 'Human switch must have aria-label');
  assert.ok(componentSource.includes(':aria-label="t(\'moduleManager.agentSwitchAria\','), 'Agent switch must have aria-label');
  assert.ok(componentSource.includes(':aria-busy="pendingHuman.has(module.id)"'), 'Human switch must reflect pending aria-busy');
  assert.ok(componentSource.includes(':aria-busy="pendingAgent.has(module.id)"'), 'Agent switch must reflect pending aria-busy');
  assert.ok(componentSource.includes('button:focus-visible'), 'CSS must include visible focus indicator');
  assert.ok(componentSource.includes('.agent-unsupported-tag'), 'CSS must include unsupported tag styling');
});
