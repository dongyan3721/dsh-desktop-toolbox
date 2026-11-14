import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { NativeOwner } from '../packages/dsh-toolbox/src/host/native-owner.js';
import { Config, DESKTOP_RUNTIME } from '../packages/dsh-toolbox/src/desktop/index.js';

test('an external desktop release is pinned independently of the plugin package', async () => {
  const root = await mkdtemp(new URL('../.tmp/external-release-', import.meta.url));
  const executable = join(root, 'desktop');
  const nativeManifest = join(root, 'desktop-manifest.json');
  const bytes = Buffer.from('synthetic executable bytes; never launched');
  await writeFile(executable, bytes);
  const manifest = { runtime: 'desktop', protocolVersion: 1, platform: process.platform, architecture: process.arch, sha256: createHash('sha256').update(bytes).digest('hex'), nativeVersion: 'independently-versioned-release' };
  const config = { ...Config({}), nativeExecutable: executable, nativeManifest, dataDir: join(root, 'data'), tempDir: root };
  const stop = Object.assign(new Error('pre-spawn test boundary'), { code: 'TEST_BOUNDARY' });
  let resolutions = 0;
  const subprocess = { async resolveExecutable() { resolutions++; throw stop; } };
  for (const patch of [{ sha256: 'wrong' }, { protocolVersion: 2 }, { architecture: 'other' }, { runtime: 'headless' }]) {
    await writeFile(nativeManifest, JSON.stringify({ ...manifest, ...patch }));
    const owner = new NativeOwner(subprocess, config, DESKTOP_RUNTIME);
    await assert.rejects(owner.start(), { code: 'NATIVE_INTEGRITY' });
    await owner.close();
  }
  assert.equal(resolutions, 0, 'incompatible or altered releases fail before process resolution/spawn');
  await writeFile(nativeManifest, JSON.stringify(manifest));
  const owner = new NativeOwner(subprocess, config, DESKTOP_RUNTIME);
  await assert.rejects(owner.start(), { code: 'TEST_BOUNDARY' });
  await owner.close();
  assert.equal(resolutions, 1);
});
