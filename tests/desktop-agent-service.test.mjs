import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ToolboxDesktopService } from '../packages/dsh-toolbox/src/desktop/index.js';
import { normalizeAgentAccess } from '../packages/dsh-toolbox/src/desktop/agent-access.js';

const snapshot = (allowed = false, revision = 1) => ({ revision, modules: [{ id: 'sticky_note', agent_supported: true, agent_allowed: allowed, agent_effective: allowed }], methods: ['agent.notes.create', 'agent.notes.read'] });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };

async function fixture() {
  const ctx = new Context();
  const calls = [];
  let access = snapshot();
  let starts = 0;
  let unavailable;
  let handler;
  const owner = {
    ready: false, bridge: { isClosed: false }, capabilities: ['status', 'desktop.show_main', 'desktop.open_panel', 'desktop.shutdown', 'agent.get_access', 'agent.notes.create', 'agent.notes.read'],
    onUnavailable(fn) { unavailable = fn; },
    async start() { starts++; this.ready = true; },
    async close() { this.ready = false; },
    async request(method, params, options) {
      calls.push({ method, params, options });
      if (method === 'status') return { desktop: true, protocolVersion: 1, nativeVersion: 'fixture' };
      if (handler) { const handled = handler(method, params, options); if (handled !== undefined) return handled; }
      if (method === 'agent.get_access') return structuredClone(access);
      return { applied: true, id: 'generated-fixture' };
    },
  };
  const config = { dataDir: fileURLToPath(new URL(`../runtime/desktop-agent/${randomUUID()}/`, import.meta.url)), nativeExecutable: '', startupTimeoutMs: 1000, requestTimeoutMs: 1000, cancelTimeoutMs: 100, shutdownTimeoutMs: 1000 };
  const service = new ToolboxDesktopService(ctx, config, () => owner);
  return { ctx, service, owner, calls, starts: () => starts, setAccess: value => access = value,
    setHandler: value => handler = value,
    disconnect() { owner.ready = false; owner.bridge.isClosed = true; unavailable(); },
    close: () => ctx.fiber.dispose() };
}

test('Agent metadata strips content and rejects invalid/duplicate module metadata', () => {
  const raw = snapshot(true);
  raw.config = { private: 'generated secret fixture' };
  raw.modules[0].content = 'generated note body';
  raw.modules.push({ id: 'password_vault', agent_supported: true, agent_allowed: true, agent_effective: true });
  raw.methods.push('desktop.shutdown', 'agent.vault.reveal');
  const result = normalizeAgentAccess(raw);
  assert.equal(JSON.stringify(result).includes('generated'), false);
  assert.equal(result.modules[1].agent_effective, false);
  assert.deepEqual(result.methods, ['agent.notes.create', 'agent.notes.read']);
  assert.throws(() => normalizeAgentAccess({ ...raw, modules: [raw.modules[0], raw.modules[0]] }), { code: 'DESKTOP_PROTOCOL' });
});

test('Agent never starts/restarts a desktop and enforces live grants before dispatch', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.getAgentAccess(), { code: 'NATIVE_UNAVAILABLE' });
    assert.equal(f.starts(), 0);
    await f.service.start();
    await assert.rejects(f.service.agentCall('agent.notes.create', { title: 'fixture' }), { code: 'AGENT_ACCESS_DENIED' });
    await assert.rejects(f.service.agentCall('desktop.show_main'), { code: 'UNSUPPORTED' });
    assert.equal(f.calls.some(call => call.method === 'agent.notes.create'), false);
    f.setAccess(snapshot(true, 2));
    assert.equal((await f.service.agentCall('agent.notes.create', { title: 'fixture' })).applied, true);
    f.setAccess({ ...snapshot(true, 3), modules: [{ id: 'sticky_note', agent_supported: true, agent_allowed: true, agent_effective: false }] });
    await assert.rejects(f.service.agentCall('agent.notes.create', { title: 'fixture' }), { code: 'MODULE_DISABLED' });
    f.disconnect();
    await assert.rejects(f.service.agentCall('agent.notes.read', { id: 'fixture' }), { code: 'NATIVE_UNAVAILABLE' });
    assert.equal(f.starts(), 1);
  } finally { await f.close(); }
});

test('subscriptions withdraw immediately on disconnect and discard stale access responses', async () => {
  const f = await fixture();
  try {
    await f.service.start();
    const deliveries = [];
    const off = f.service.onAgentAccessChanged(value => deliveries.push(value));
    clearTimeout(f.service.agentAccess.pollTimer);
    f.service.agentAccess.pollTimer = undefined;
    const first = deferred(); const second = deferred(); let read = 0;
    f.setHandler(method => method === 'agent.get_access' ? (++read === 1 ? first.promise : second.promise) : undefined);
    const old = f.service.getAgentAccess(); const recent = f.service.getAgentAccess();
    second.resolve(snapshot(false, 3)); await recent;
    first.resolve(snapshot(true, 2)); await old;
    assert.equal(deliveries.at(-1).revision, 3);
    assert.equal(deliveries.at(-1).modules[0].agent_allowed, false);
    f.disconnect();
    assert.deepEqual(deliveries.at(-1).modules, []);
    off();
    assert.equal(f.service.agentAccess.listeners.size, 0);
  } finally { await f.close(); }
});

test('late cancellation preserves native committed response; pre-cancel does no work', async () => {
  const f = await fixture();
  try {
    await f.service.start(); f.setAccess(snapshot(true));
    const controller = new AbortController();
    f.setHandler(method => {
      if (method !== 'agent.notes.create') return;
      controller.abort();
      return { applied: true, id: 'committed-note' };
    });
    assert.deepEqual(await f.service.agentCall('agent.notes.create', { title: 'fixture' }, { signal: controller.signal }), { applied: true, id: 'committed-note' });
    const count = f.calls.length;
    await assert.rejects(f.service.agentCall('agent.notes.create', { title: 'fixture' }, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(f.calls.length, count);
  } finally { await f.close(); }
});

test('disposing an in-flight poll publishes empty access and releases subscription timer', async () => {
  const f = await fixture();
  await f.service.start();
  const pending = deferred();
  f.setHandler(method => method === 'agent.get_access' ? pending.promise : undefined);
  const deliveries = [];
  f.service.onAgentAccessChanged(value => deliveries.push(value));
  await new Promise(resolve => setTimeout(resolve, 20));
  await f.close();
  pending.resolve(snapshot(true));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.service.agentAccess.listeners.size, 0);
  assert.equal(f.service.agentAccess.pollTimer, undefined);
  assert.deepEqual(deliveries.at(-1).modules, []);
});
