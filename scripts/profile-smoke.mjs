// Acceptance-only Cordis driver: runs inside the installed dsh CLI, without an LLM request.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { imageDimensions } from './image-fixture.mjs';

export const name = 'toolbox-profile-acceptance';
export const inject = ['tools'];
export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (!exit) throw new Error('Acceptance driver requires the actual dsh launcher');
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('Profile acceptance deadline exceeded')), 45000);
  const work = run(ctx, controller.signal).then(
    result => { console.log(`TOOLBOX_ACCEPTANCE ${JSON.stringify(result)}`); exit(0); },
    error => { console.error(`TOOLBOX_ACCEPTANCE_FAILED ${error.code || error.name}: ${error.message}`); exit(1); },
  ).finally(() => clearTimeout(deadline));
  ctx.effect(() => async () => { controller.abort(); clearTimeout(deadline); await work; });
}

async function run(ctx, signal) {
  await ctx.get('loader')?.await();
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'toolbox-native');
  assert.ok(entry?.fiber, 'Installed plugin entry must exist');
  await entry.fiber.await();
  const call = async (name, args) => {
    const batch = await ctx.tools.execute({ calls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }], signal });
    const result = batch.results[0].result;
    assert.equal(result.isError, false, result.error?.message);
    return result.value;
  };
  const status = await call('toolbox_status', {});
  assert.equal(status.nativeConnected, true);
  if (process.env.DSH_TOOLBOX_ACCEPTANCE_PHASE === 'images') {
    const root = process.env.DSH_TOOLBOX_ACCEPTANCE_MEDIA;
    assert.ok(root);
    await ctx.loader.update(entry.id, { config: {
      dataDir: join(process.env.DSH_HOME, 'toolbox-data'),
      enableImages: true, readRoots: [join(root, 'inputs')], writeRoots: [join(root, 'outputs')],
    } });
    await ctx.loader.await();
    await entry.fiber.await();
    for (const format of ['png', 'jpeg', 'webp', 'bmp', 'ico']) {
      const outputPath = join(root, 'outputs', `converted.${format}`);
      const result = await call('toolbox_image_convert', { inputPath: join(root, 'inputs', 'generated.bmp'), outputPath, format });
      assert.equal(result.format, format);
      assert.deepEqual(imageDimensions(await readFile(outputPath), format), [2, 2]);
    }
    return { nativeConnected: true, realImageFormats: 5, reloadedConfiguration: true, source: entry.options.name };
  }
  const token = process.env.DSH_TOOLBOX_ACCEPTANCE_TOKEN || `acceptance-${randomUUID()}`;
  if (process.env.DSH_TOOLBOX_ACCEPTANCE_PHASE === 'restart') {
    const found = await call('toolbox_note_search', { query: token });
    assert.equal(found.total, 1);
    assert.equal(found.items[0].title, 'verified acceptance fixture');
    return { nativeConnected: true, persistedAcrossProfileRestart: true, source: entry.options.name };
  }
  const note = await call('toolbox_note_create', { title: 'isolated acceptance fixture', content_md: token });
  const found = await call('toolbox_note_search', { query: token });
  assert.equal(found.items[0].id, note.id);
  const updated = await call('toolbox_note_update', { id: note.id, title: 'verified acceptance fixture', expected_updated_at: note.updated_at });
  assert.ok(updated.updated_at > note.updated_at);
  return { nativeConnected: true, notesCreatedSearchedUpdated: true, source: entry.options.name };
}
