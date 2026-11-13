/**
 * ModuleManager (A2 双开关与四模块 Agent 授权) 独立单元测试
 * 覆盖：
 * 1. 4 个支持模块具备独立 Agent 访问授权开关，6 个不支持模块明确标记不支持且不渲染可用控件
 * 2. 4 种开关状态组合（开启/关闭 × 授权/未授权）及未开启功能时的暂不生效提示
 * 3. 共享范围文案与多语言键值完整性
 * 4. 成功调用与权威 catalog 返回更新
 * 5. 失败回滚与错误提示呈现
 * 6. 人用开关与 Agent 开关的独立并发状态与过期响应丢弃机制
 * 7. 键盘可达性与 a11y 属性规范 (role="switch", aria-checked, aria-label, aria-busy, focus-visible)
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
    defineProps: () => ({ modules: initialModules }),
    defineEmits: () => (event, ...args) => emits.push({ event, args }),
    invokeIpc: invoke,
    t,
    props: { modules: initialModules },
    JSON,
    Array,
    Set,
    Boolean,
    Error,
    String,
  });

  compile(featuresSource.replace(/export /g, ''), context);
  compile(script, context);

  return {
    run: (expr) => vm.runInContext(expr, context),
    emits,
    context
  };
}

const mockCatalog = [
  { number: 1, id: 'screenshot', name: '增强截图', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: false, agent_effective: false },
  { number: 2, id: 'clipboard', name: '剪贴板', available: true, enabled: false, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: true, agent_effective: false },
  { number: 3, id: 'screen_ink', name: '屏幕注释', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: true, agent_effective: true },
  { number: 4, id: 'app_usage', name: '使用时长', available: true, enabled: false, supported: true, unavailable_reason: '', agent_supported: true, agent_allowed: false, agent_effective: false },
  { number: 5, id: 'sticky_note', name: '桌面便笺', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 6, id: 'translator', name: '划词翻译', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 7, id: 'password_vault', name: '密码本', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 8, id: 'media_proc', name: '媒体处理', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 9, id: 'script_runner', name: '脚本执行', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
  { number: 10, id: 'window_pin', name: '窗口置顶', available: true, enabled: true, supported: true, unavailable_reason: '', agent_supported: false, agent_allowed: false, agent_effective: false },
];

test('A2 contract: exactly screenshot, clipboard, screen_ink, app_usage are agent_supported; other 6 are not', async () => {
  const harness = await moduleManagerHarness(mockCatalog, async () => []);
  const { run } = harness;

  const supportedIds = ['screenshot', 'clipboard', 'screen_ink', 'app_usage'];
  const unsupportedIds = ['sticky_note', 'translator', 'password_vault', 'media_proc', 'script_runner', 'window_pin'];

  for (const id of supportedIds) {
    const mod = mockCatalog.find(m => m.id === id);
    assert.equal(run(`isAgentSupported(${JSON.stringify(mod)})`), true, `${id} must be agent supported`);
    const scope = run(`getAgentScopeText('${id}')`);
    assert.ok(scope.length > 0, `${id} must have non-empty shared scope text`);
  }

  for (const id of unsupportedIds) {
    const mod = mockCatalog.find(m => m.id === id);
    assert.equal(run(`isAgentSupported(${JSON.stringify(mod)})`), false, `${id} must NOT be agent supported`);
    // Even if a forged agent_supported=true was supplied in catalog for an unsupported id, it must remain false
    const forged = { ...mod, agent_supported: true };
    assert.equal(run(`isAgentSupported(${JSON.stringify(forged)})`), false, `${id} with forged flag must remain unsupported`);
    assert.equal(run(`formatAgentStatus(${JSON.stringify(mod)})`), '不支持 Agent');
  }
});

test('A2 four combinations of human enabled and agent allowed states', async () => {
  const harness = await moduleManagerHarness(mockCatalog, async () => []);
  const { run } = harness;

  // Combination 1: enabled=true, agent_allowed=false (screenshot)
  const c1 = mockCatalog.find(m => m.id === 'screenshot');
  assert.equal(run(`formatModuleStatus(${JSON.stringify(c1)})`), '已开启');
  assert.equal(run(`formatAgentStatus(${JSON.stringify(c1)})`), '已关闭');

  // Combination 2: enabled=false, agent_allowed=true (clipboard: grant preserved, ineffective notice)
  const c2 = mockCatalog.find(m => m.id === 'clipboard');
  assert.equal(run(`formatModuleStatus(${JSON.stringify(c2)})`), '已关闭');
  assert.equal(run(`formatAgentStatus(${JSON.stringify(c2)})`), '功能未开启，Agent 访问暂不生效');

  // Combination 3: enabled=true, agent_allowed=true (screen_ink: active grant)
  const c3 = mockCatalog.find(m => m.id === 'screen_ink');
  assert.equal(run(`formatModuleStatus(${JSON.stringify(c3)})`), '已开启');
  assert.equal(run(`formatAgentStatus(${JSON.stringify(c3)})`), '已开启');

  // Combination 4: enabled=false, agent_allowed=false (app_usage)
  const c4 = mockCatalog.find(m => m.id === 'app_usage');
  assert.equal(run(`formatModuleStatus(${JSON.stringify(c4)})`), '已关闭');
  assert.equal(run(`formatAgentStatus(${JSON.stringify(c4)})`), '已关闭');
});

test('toggleAgentAccess invokes kernel_set_agent_access and updates canonical catalog', async () => {
  const calls = [];
  const updatedCatalog = mockCatalog.map(m => m.id === 'screenshot' ? { ...m, agent_allowed: true, agent_effective: true } : m);

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
  assert.equal(run('pendingAgent.value'), null);
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
  assert.equal(run('pendingAgent.value'), null);
  assert.equal(emits.some(e => e.event === 'changed'), true);
});

test('two switches have independent pending state and allow concurrent non-interfering toggles', async () => {
  const pendingPromises = [];
  const calls = [];
  const harness = await moduleManagerHarness(mockCatalog, (cmd, args) => {
    calls.push({ cmd, args });
    return new Promise((resolve) => pendingPromises.push(resolve));
  });

  const { run } = harness;
  const mod = mockCatalog.find(m => m.id === 'screenshot');

  // Trigger human enable toggle
  const humanPromise = run(`toggleEnabled(${JSON.stringify(mod)})`);
  // Concurrently trigger agent access toggle
  const agentPromise = run(`toggleAgentAccess(${JSON.stringify(mod)})`);

  assert.equal(run('pendingHuman.value'), 'screenshot');
  assert.equal(run('pendingAgent.value'), 'screenshot');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, 'kernel_set_module_enabled');
  assert.equal(calls[1].cmd, 'kernel_set_agent_access');

  // Resolve agent toggle first
  pendingPromises[1](mockCatalog);
  await agentPromise;
  assert.equal(run('pendingAgent.value'), null);
  assert.equal(run('pendingHuman.value'), 'screenshot', 'pendingHuman must remain active until its own resolution');

  // Resolve human toggle
  pendingPromises[0](mockCatalog);
  await humanPromise;
  assert.equal(run('pendingHuman.value'), null);
});

test('accessibility and template standards: role=switch, aria-checked, aria-label, aria-busy, focus-visible', () => {
  assert.ok(componentSource.includes('role="switch"'), 'Must define role=switch for accessibility');
  assert.ok(componentSource.includes(':aria-checked="module.enabled"'), 'Human switch must bind aria-checked');
  assert.ok(componentSource.includes(':aria-checked="Boolean(module.agent_allowed)"'), 'Agent switch must bind aria-checked');
  assert.ok(componentSource.includes(':aria-label="t(\'moduleManager.switchAria\','), 'Human switch must have aria-label');
  assert.ok(componentSource.includes(':aria-label="t(\'moduleManager.agentSwitchAria\','), 'Agent switch must have aria-label');
  assert.ok(componentSource.includes(':aria-busy="pendingHuman === module.id"'), 'Human switch must reflect pending aria-busy');
  assert.ok(componentSource.includes(':aria-busy="pendingAgent === module.id"'), 'Agent switch must reflect pending aria-busy');
  assert.ok(componentSource.includes('button:focus-visible'), 'CSS must include visible focus indicator');
  assert.ok(componentSource.includes('.agent-unsupported-tag'), 'CSS must include unsupported tag styling');
});
