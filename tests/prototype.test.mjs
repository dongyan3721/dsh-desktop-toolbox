import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolboxContext } from '../scripts/test-context.mjs';

test('built native plugin loads through actual Loader and executes notes through the real pipeline', { timeout: 20000 }, async () => {
  const harness = await createToolboxContext();
  const { ctx } = harness;
  try {
    const tool = ctx.tools.definitions().find(tool => tool.name === 'toolbox_status');
    assert.ok(tool, 'actual Loader must register the built tool');
    const value = await tool.execute({}, { signal: new AbortController().signal });
    assert.equal(value.nativeConnected, true);
    assert.equal(value.phase, 'ready');
    assert.ok(value.capabilities.includes('notes.create'));
    const batch = await ctx.tools.execute({ calls: [{ id: 'status-test', name: 'toolbox_status', arguments: '{}' }], signal: new AbortController().signal });
    assert.equal(batch.results[0].result.isError, false);
    assert.equal(batch.results[0].result.value.nativeConnected, true);
    const note = await harness.call('toolbox_note_create', { title: 'loader fixture', content_md: 'real sqlite fixture' });
    assert.equal(note.isError, false);
    assert.equal(note.value.is_open, false);
    const found = await harness.call('toolbox_note_search', { query: 'real sqlite fixture' });
    assert.equal(found.value.items[0].id, note.value.id);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(tool.execute({}, { signal: controller.signal }), { name: 'AbortError' });
    await harness.unload();
    assert.equal(ctx.tools.definitions().some(tool => tool.name === 'toolbox_status'), false);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('native note persists across actual Loader teardown and reactivation', { timeout: 20000 }, async () => {
  const first = await createToolboxContext();
  const created = await first.call('toolbox_note_create', { title: 'restart fixture', content_md: 'restart-owned-fixture' });
  await first.close();
  const harness = await createToolboxContext({ dataDir: first.dataDir });
  try {
    const result = await harness.call('toolbox_note_search', { query: 'restart-owned-fixture' });
    assert.equal(result.isError, false);
    assert.equal(result.value.items[0].id, created.value.id);
  } finally {
    await harness.close();
  }
});

test('outer Harness cancellation after a committed native write is not treated as rollback', { timeout: 15000 }, async () => {
  const harness = await createToolboxContext();
  const controller = new AbortController();
  const remove = harness.ctx.on('tools/execute', async (exec, next) => {
    const result = await next();
    if (exec.name === 'toolbox_note_create') controller.abort();
    return result;
  });
  try {
    const result = await harness.call('toolbox_note_create', { title: 'commit race fixture', content_md: 'committed-before-outer-abort' }, controller.signal);
    assert.equal(result.isError, true);
    assert.match(result.error.info.code, /ABORTED/);
    remove();
    const persisted = await harness.call('toolbox_note_search', { query: 'committed-before-outer-abort' });
    assert.equal(persisted.value.total, 1);
  } finally { remove(); await harness.close(); }
});
