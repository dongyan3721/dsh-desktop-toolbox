import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nativeTargets } from '../scripts/bundle-github.mjs';
import { runtimeTarget } from '../packages/dsh-toolbox/src/host/runtime-target.js';
import { DESKTOP_RUNTIME } from '../packages/dsh-toolbox/src/desktop/index.js';

test('the shared plugin version installs on both systems and maps each declared native payload', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const host = JSON.parse(await readFile(new URL('../packages/dsh-toolbox/package.json', import.meta.url)));
  const client = JSON.parse(await readFile(new URL('../packages/dsh-toolbox-client/package.json', import.meta.url)));
  for (const pkg of [root, host, client]) {
    assert.equal(pkg.os, undefined, `${pkg.name}: JavaScript packages must not block platform installation`);
    assert.equal(pkg.cpu, undefined, `${pkg.name}: JavaScript packages must not block CPU installation`);
    assert.equal(pkg.version, root.version);
  }
  assert.deepEqual(root.dshToolbox.nativeTargets, host.dshToolbox.nativeTargets);
  const targets = nativeTargets(root);
  assert.deepEqual(new Set(targets.map(t => t.platform)), new Set(['win32', 'darwin']));
  for (const target of targets) {
    const runtime = runtimeTarget(DESKTOP_RUNTIME, target.platform, target.architecture);
    assert.equal(runtime.manifest, target.manifests[0][0]);
    assert.equal(runtime.executable, target.manifests[0][1]);
  }
  assert.equal(client.peerDependencies['dsh-toolbox'], root.version);
});
