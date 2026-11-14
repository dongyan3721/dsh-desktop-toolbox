import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildGithubBundle, verifyGithubBundle } from '../scripts/bundle-github.mjs';

const revision = '1'.repeat(40);
async function fixture(t) {
  const temp = resolve('.tmp');
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, 'github-bundle-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  // Preserve the Windows layout regression even when this release targets Mac.
  pkg.os = ['win32']; pkg.cpu = ['x64'];
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  const host = join(root, 'packages/dsh-toolbox');
  const client = join(root, 'packages/dsh-toolbox-client');
  for (const directory of [client, join(host, 'lib/human-entry'), join(host, 'lib/desktop'), join(host, 'lib/agent'), join(host, 'resources/win32-x64')]) await mkdir(directory, { recursive: true });
  await writeFile(join(host, 'package.json'), JSON.stringify({ version: pkg.version, peerDependencies: pkg.peerDependencies }));
  await writeFile(join(client, 'package.json'), JSON.stringify({ version: pkg.version, peerDependencies: { 'dsh-toolbox': pkg.version } }));
  for (const name of ['human-entry/host.js', 'desktop/index.js', 'agent/index.js']) await writeFile(join(host, 'lib', name), 'export function apply() {}\n');
  await writeFile(join(client, 'client.js'), "window.__ModuleLoader__.load({\n  id: 'dsh-toolbox-client',\n  factory: () => ({})\n});\n");
  for (const [name, binary, runtime] of [['desktop-manifest.json', 'all-in-one-desktop.exe', 'desktop'], ['native-manifest.json', 'dsh-toolbox-native.exe', undefined]]) {
    const bytes = Buffer.from(`synthetic:${binary}`);
    await writeFile(join(host, 'resources/win32-x64', binary), bytes);
    await writeFile(join(host, 'resources', name), JSON.stringify({ pluginVersion: pkg.version, platform: 'win32', architecture: 'x64', protocolVersion: 1, runtime, nativeSourceRevision: revision, sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
  return { root, host, client, pkg };
}

test('complete Bundle is self-contained and registers its own browser package identity', async t => {
  const f = await fixture(t);
  const manifest = await buildGithubBundle({ root: f.root, sourceRevision: revision });
  assert.equal(manifest.sourceRevision, revision);
  assert.equal(manifest.version, f.pkg.version);
  assert.equal(manifest.files.length, 8);
  assert.match(await readFile(join(f.root, 'distribution/client.js'), 'utf8'), /id: 'dsh-toolbox-bundle'/);
  assert.match(await readFile(join(f.client, 'client.js'), 'utf8'), /id: 'dsh-toolbox-client'/);
  assert.deepEqual(await verifyGithubBundle(f.root), manifest);
});

test('corrupt native input fails before replacing the previous complete Bundle', async t => {
  const f = await fixture(t);
  await buildGithubBundle({ root: f.root, sourceRevision: revision });
  const previous = await readFile(join(f.root, 'distribution/manifest.json'), 'utf8');
  await writeFile(join(f.host, 'resources/win32-x64/all-in-one-desktop.exe'), 'corrupted');
  await assert.rejects(buildGithubBundle({ root: f.root, sourceRevision: revision }), /native integrity/);
  assert.equal(await readFile(join(f.root, 'distribution/manifest.json'), 'utf8'), previous);
  await verifyGithubBundle(f.root);
});

test('distribution verification rejects changed or additional runtime files', async t => {
  const f = await fixture(t);
  await buildGithubBundle({ root: f.root, sourceRevision: revision });
  await writeFile(join(f.root, 'distribution/client.js'), 'changed');
  await assert.rejects(verifyGithubBundle(f.root), /integrity mismatch/);
  await buildGithubBundle({ root: f.root, sourceRevision: revision });
  await writeFile(join(f.root, 'distribution/unlisted.js'), 'unexpected');
  await assert.rejects(verifyGithubBundle(f.root), /inventory mismatch/);
});

test('assembly rejects mixed versions and installation hooks', async t => {
  const f = await fixture(t);
  await writeFile(join(f.client, 'package.json'), JSON.stringify({ version: '0.0.0', peerDependencies: { 'dsh-toolbox': f.pkg.version } }));
  await assert.rejects(buildGithubBundle({ root: f.root, sourceRevision: revision }), /versions must match/);
  f.pkg.scripts.prepare = 'node download.mjs';
  await writeFile(join(f.root, 'package.json'), JSON.stringify(f.pkg));
  await assert.rejects(buildGithubBundle({ root: f.root, sourceRevision: revision }), /Installation hook/);
});

test('assembly refuses a junction instead of deleting its target', async t => {
  const f = await fixture(t);
  const target = join(f.root, 'junction-target');
  await mkdir(target);
  await writeFile(join(target, 'marker'), 'keep');
  await symlink(target, join(f.root, 'distribution'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(buildGithubBundle({ root: f.root, sourceRevision: revision }), /linked distribution/);
  assert.equal(await readFile(join(target, 'marker'), 'utf8'), 'keep');
});

test('Mac Git URL distribution preserves app identity, architecture and executable inventory', async t => {
  const f = await fixture(t);
  f.pkg.os = ['darwin']; f.pkg.cpu = ['arm64'];
  await writeFile(join(f.root, 'package.json'), JSON.stringify(f.pkg));
  const resources = join(f.host, 'resources');
  const app = join(resources, 'darwin-arm64/All-in-One Toolbox.app/Contents');
  await mkdir(join(app, 'MacOS'), { recursive: true });
  await mkdir(join(app, 'Resources'), { recursive: true });
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);bytes.writeUInt32LE(0x0100000c, 4);bytes.writeUInt32LE(2, 12);
  const binary = join(app, 'MacOS/all-in-one-desktop');
  await writeFile(binary, bytes, { mode: 0o755 });
  await writeFile(join(app, 'Info.plist'), '<plist>synthetic app identity</plist>');
  await writeFile(join(app, 'Resources/icon.icns'), 'synthetic icon');
  await writeFile(join(resources, 'darwin-arm64/desktop-manifest.json'), JSON.stringify({ pluginVersion: f.pkg.version, platform: 'darwin', architecture: 'arm64', runtime: 'desktop', protocolVersion: 1, nativeSourceRevision: revision, sha256: createHash('sha256').update(bytes).digest('hex') }));
  const manifest = await buildGithubBundle({ root: f.root, sourceRevision: revision });
  assert.ok(manifest.files.some(file => file.path.endsWith('/Info.plist')));
  assert.equal(manifest.files.filter(file => file.executable).length, 1);
  assert.ok(manifest.files.every(file => !file.path.endsWith('.exe')));
  const installed = join(f.root, 'distribution/resources/darwin-arm64/All-in-One Toolbox.app/Contents/MacOS/all-in-one-desktop');
  if (process.platform !== 'win32') {
    await chmod(installed, 0o644);
    await assert.rejects(verifyGithubBundle(f.root), /executable mode/);
  }
  bytes.writeUInt32LE(0x01000007, 4);
  await writeFile(binary, bytes);
  await assert.rejects(buildGithubBundle({ root: f.root, sourceRevision: revision }), /integrity manifest/);
});
