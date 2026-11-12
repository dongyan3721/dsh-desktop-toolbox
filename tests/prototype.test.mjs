import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrototypeContext } from '../scripts/prototype-context.mjs';

test('built plugin loads through Cordis Loader, validates cancellation and unloads', async () => {
  const { ctx, id } = await createPrototypeContext();
  try {
    const tool = ctx.tools.definitions().find(tool => tool.name === 'toolbox_status');
    assert.ok(tool, 'actual Loader must register the built tool');
    const value = await tool.execute({}, { signal: new AbortController().signal });
    assert.equal(value.nativeConnected, false);
    assert.equal(value.phase, 'prototype');
    assert.equal(value.plannedModuleCount, 10);
    assert.ok(tool.output.render({}, value)[0].text.includes('原生连接尚未接入'));
    const batch = await ctx.tools.execute({ calls: [{ id: 'status-test', name: 'toolbox_status', arguments: '{}' }], signal: new AbortController().signal });
    assert.equal(batch.results[0].result.isError, false);
    assert.equal(batch.results[0].result.value.nativeConnected, false);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(tool.execute({}, { signal: controller.signal }), { name: 'AbortError' });
    await ctx.loader.remove(id);
    assert.equal(ctx.tools.definitions().some(tool => tool.name === 'toolbox_status'), false);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('installed tarball loads and executes without importing plugin source', async () => {
  const moduleUrl = new URL('../runtime/dsh-dev/profiles/toolbox-prototype/node_modules/dsh-toolbox/lib/index.js', import.meta.url).href;
  const { ctx, id } = await createPrototypeContext({ moduleUrl });
  try {
    const batch = await ctx.tools.execute({ calls: [{ id: 'installed-status', name: 'toolbox_status', arguments: '{}' }], signal: new AbortController().signal });
    assert.equal(batch.results[0].result.isError, false);
    assert.equal(batch.results[0].result.value.phase, 'prototype');
    await ctx.loader.resolve(id).fiber.dispose();
    ctx.loader.remove(id);
    assert.equal(ctx.tools.definitions().some(tool => tool.name === 'toolbox_status'), false);
  } finally {
    await ctx.fiber.dispose();
  }
});
