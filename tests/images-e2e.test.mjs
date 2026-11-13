import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createToolboxContext } from '../scripts/test-context.mjs';
import { tinyBmp, imageDimensions } from '../scripts/image-fixture.mjs';

test('real Loader image tool converts all five formats and enforces file boundaries', { timeout: 30000 }, async () => {
  const root = fileURLToPath(new URL(`../runtime/images-e2e/${randomUUID()}/`, import.meta.url));
  const inputs = join(root, 'inputs');
  const outputs = join(root, 'outputs');
  await mkdir(inputs, { recursive: true });
  await mkdir(outputs, { recursive: true });
  const source = join(inputs, 'generated.bmp');
  await writeFile(source, tinyBmp());
  const harness = await createToolboxContext({ dataDir: join(root, 'data'), config: { enableImages: true, readRoots: [inputs], writeRoots: [outputs] } });
  try {
    assert.ok(harness.ctx.tools.definitions().some(tool => tool.name === 'toolbox_image_convert'));
    for (const format of ['png', 'jpeg', 'webp', 'bmp', 'ico']) {
      const outputPath = join(outputs, `converted.${format}`);
      const converted = await harness.call('toolbox_image_convert', { inputPath: source, outputPath, format });
      assert.equal(converted.isError, false, converted.error?.message);
      assert.equal(converted.value.outputPath.toLowerCase(), outputPath.toLowerCase());
      assert.equal(converted.value.format, format);
      assert.deepEqual(imageDimensions(await readFile(outputPath), format), [2, 2]);
    }
    const unicodeOutput = join(outputs, 'trailing.png\u00a0');
    const unicode = await harness.call('toolbox_image_convert', { inputPath: source, outputPath: unicodeOutput, format: 'png' });
    assert.equal(unicode.isError, false, unicode.error?.message);
    assert.equal(unicode.value.outputPath.toLowerCase(), unicodeOutput.toLowerCase());
    assert.deepEqual(imageDimensions(await readFile(unicodeOutput), 'png'), [2, 2]);
    const existing = join(outputs, 'existing.png');
    await writeFile(existing, 'keep-original');
    assert.equal((await harness.call('toolbox_image_convert', { inputPath: source, outputPath: existing, format: 'png' })).isError, true);
    assert.equal(await readFile(existing, 'utf8'), 'keep-original');
    const outside = join(root, 'outside.png');
    assert.equal((await harness.call('toolbox_image_convert', { inputPath: source, outputPath: outside, format: 'png' })).isError, true);
    await assert.rejects(access(outside));
    const bad = join(inputs, 'bad.bmp');
    await writeFile(bad, 'not-an-image');
    const badOutput = join(outputs, 'bad.png');
    assert.equal((await harness.call('toolbox_image_convert', { inputPath: bad, outputPath: badOutput, format: 'png' })).isError, true);
    await assert.rejects(access(badOutput));
    assert.deepEqual((await readdir(outputs)).sort(), ['converted.bmp', 'converted.ico', 'converted.jpeg', 'converted.png', 'converted.webp', 'existing.png', 'trailing.png\u00a0']);
  } finally { await harness.close(); }
});
