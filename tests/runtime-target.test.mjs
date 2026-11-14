import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeTarget } from '../packages/dsh-toolbox/src/host/runtime-target.js';
import { DESKTOP_RUNTIME } from '../packages/dsh-toolbox/src/desktop/index.js';

test('desktop targets keep Windows and macOS integrity manifests separate', () => {
  assert.equal(runtimeTarget(DESKTOP_RUNTIME, 'win32', 'x64').manifest, 'desktop-manifest.json');
  for (const architecture of ['arm64', 'x64']) {
    const target = runtimeTarget(DESKTOP_RUNTIME, 'darwin', architecture);
    assert.equal(target.manifest, `darwin-${architecture}/desktop-manifest.json`);
    assert.equal(target.executable, `darwin-${architecture}/all-in-one-desktop`);
  }
  assert.throws(() => runtimeTarget(DESKTOP_RUNTIME, 'linux', 'x64'), { code: 'UNSUPPORTED' });
  assert.throws(() => runtimeTarget(DESKTOP_RUNTIME, 'win32', 'arm64'), { code: 'UNSUPPORTED' });
});
