import test from 'node:test';
import assert from 'node:assert/strict';
import { createHumanEntryHandler } from '../src/human-entry/host.js';
import { validateConsoleRequest } from '../src/human-entry/console.js';

test('human console only forwards closed actions and preserves cancellation signal', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const handler = createHumanEntryHandler(() => ({ console(payload, options) { calls.push({ payload, options }); return { module_catalog: [] }; } }));
  const payload = { action: 'setAgentAccess', args: { moduleId: 'sticky_note', allowed: true } };
  assert.deepEqual(await handler('console', payload, signal), { ok: true, value: { module_catalog: [] } });
  assert.deepEqual(calls, [{ payload, options: { signal } }]);
  for (const bad of [
    { action: 'invoke', args: { cmd: 'vault_list' } },
    { action: 'snapshot', args: { actor: 'human' } },
    { action: 'snapshot', args: {}, actor: 'human' },
    { action: 'setAgentAccess', args: { moduleId: 'script_runner', allowed: true } },
    { action: 'updateGeneral', args: { launch_at_login: true } },
    { action: 'checkShortcut', args: { actionId: 'a' } },
    { action: 'setModuleEnabled', args: { moduleId: 'clipboard', enabled: 'true' } },
  ]) assert.equal((await handler('console', bad, signal)).error.code, 'INVALID_REQUEST');
  assert.equal(calls.length, 1);
  const controller = new AbortController(); controller.abort();
  assert.equal((await handler('console', payload, controller.signal)).error.code, 'CANCELLED');
  assert.equal(calls.length, 1);
});

test('console validates the supported settings and nullable shortcut operations', () => {
  for (const payload of [
    { action: 'snapshot', args: {} },
    { action: 'updateGeneral', args: { language: 'ja-JP', theme: 'dark' } },
    { action: 'updateShortcut', args: { actionId: 'clipboard:toggle_popup', hotkey: null } },
    { action: 'checkShortcut', args: { actionId: 'clipboard:toggle_popup', hotkey: '' } },
  ]) assert.deepEqual(validateConsoleRequest(payload), payload);
});
