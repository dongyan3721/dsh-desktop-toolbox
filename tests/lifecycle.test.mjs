import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolboxContext } from '../scripts/test-context.mjs';

test('20 real Loader load/unload cycles release registrations, process ranges and the same data lock', { timeout: 60000 }, async () => {
  let dataDir;
  for (let iteration = 0; iteration < 20; iteration++) {
    const harness = await createToolboxContext({ ...(dataDir ? { dataDir } : {}) });
    dataDir = harness.dataDir;
    try {
      const status = await harness.call('toolbox_status', {});
      assert.equal(status.isError, false);
      assert.equal(status.value.nativeConnected, true);
      const names = harness.ctx.tools.definitions().map(tool => tool.name);
      assert.equal(new Set(names).size, names.length);
      assert.equal(names.length, 4);
      await harness.unload();
      assert.equal(harness.ctx.tools.definitions().length, 0);
    } finally { await harness.close(); }
  }
});

test('a conflicting instance fails startup without interrupting the existing plugin', { timeout: 20000 }, async () => {
  const first = await createToolboxContext();
  try {
    await assert.rejects(createToolboxContext({ dataDir: first.dataDir }), { code: 'NATIVE_START_FAILED' });
    const status = await first.call('toolbox_status', {});
    assert.equal(status.value.nativeConnected, true);
  } finally { await first.close(); }
});

test('invalid lifecycle configuration and missing executable fail loading without tools', { timeout: 15000 }, async () => {
  await assert.rejects(createToolboxContext({ config: { dataDir: 'relative' } }), { code: 'INVALID_CONFIG' });
  await assert.rejects(createToolboxContext({ config: { startupTimeoutMs: 0 } }), { code: 'INVALID_CONFIG' });
  await assert.rejects(createToolboxContext({ config: { nativeExecutable: 'D:/Code/dsh-toolbox/.worktrees/integration/.tmp/missing-native.exe' } }), /not an executable/);
});
