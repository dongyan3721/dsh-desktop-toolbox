import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleDesktopMacos } from '../scripts/bundle-desktop-macos.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const sourceRevision = 'a'.repeat(40);

function syntheticMachO(architecture) {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(architecture === 'arm64' ? 0x0100000c : 0x01000007, 4);
  header.writeUInt32LE(2, 12);
  return Buffer.concat([header, Buffer.from(`synthetic ${architecture} fixture`)]);
}

async function fixture(t) {
  const tempRoot = await mkdtemp(join(workspace, '.tmp', 'macos package test '));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const host = join(tempRoot, 'packages/dsh-toolbox');
  const windowsResources = join(host, 'resources/win32-x64');
  const binaryDir = join(tempRoot, 'build output with spaces');
  await mkdir(windowsResources, { recursive: true });
  await mkdir(binaryDir, { recursive: true });
  await writeFile(join(host, 'package.json'), JSON.stringify({
    version: '0.1.0-test',
    peerDependencies: { '@deepseek-ai/dsh-subprocess': '0.2.2-rc.3' },
  }));
  const windowsBinary = Buffer.from('existing windows binary');
  const windowsManifest = Buffer.from('existing windows manifest');
  await writeFile(join(windowsResources, 'all-in-one-desktop.exe'), windowsBinary);
  await writeFile(join(tempRoot, 'packages/dsh-toolbox/resources/desktop-manifest.json'), windowsManifest);

  return {
    root: tempRoot,
    binaryDir,
    windowsBinary,
    windowsManifest,
  };
}

test('macOS architectures bundle independently and preserve Windows resources', async t => {
  const f = await fixture(t);
  const outputs = new Map();

  for (const [platform, architecture] of [['darwin-arm64', 'arm64'], ['darwin-x64', 'x64']]) {
    const bytes = syntheticMachO(architecture);
    const app = join(f.binaryDir, platform, 'All-in-One Toolbox.app');
    await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
    await mkdir(join(app, 'Contents/Resources'), { recursive: true });
    const plist = '<plist><dict><key>CFBundleExecutable</key><string>all-in-one-desktop</string></dict></plist>';
    await writeFile(join(app, 'Contents/Info.plist'), plist);
    await writeFile(join(app, 'Contents/Resources/icon.icns'), 'synthetic icon');
    const binaryPath = join(app, 'Contents/MacOS/all-in-one-desktop');
    await writeFile(binaryPath, bytes, { mode: 0o755 });
    await chmod(binaryPath, 0o755);

    const manifest = await bundleDesktopMacos({
      root: f.root,
      platform,
      binaryPath,
      sourceRevision,
    });
    const resourceDir = join(f.root, 'packages/dsh-toolbox/resources', platform);
    const bundledApp = join(resourceDir, 'All-in-One Toolbox.app');
    const bundledPath = join(bundledApp, 'Contents/MacOS/all-in-one-desktop');
    const bundledBinary = await readFile(bundledPath);
    const diskManifest = JSON.parse(await readFile(join(resourceDir, 'desktop-manifest.json'), 'utf8'));

    assert.deepEqual(bundledBinary, bytes);
    assert.equal((await stat(bundledPath)).mode & 0o111, 0o111);
    assert.equal(await readFile(join(bundledApp, 'Contents/Info.plist'), 'utf8'), plist);
    assert.equal(await readFile(join(bundledApp, 'Contents/Resources/icon.icns'), 'utf8'), 'synthetic icon');
    assert.deepEqual(manifest, {
      runtime: 'desktop',
      pluginVersion: '0.1.0-test',
      harnessVersion: '0.2.2-rc.3',
      protocolVersion: 1,
      platform: 'darwin',
      architecture,
      nativeSourceRevision: sourceRevision,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    assert.deepEqual(diskManifest, manifest);
    outputs.set(platform, bundledBinary);
  }

  assert.notDeepEqual(outputs.get('darwin-arm64'), outputs.get('darwin-x64'));
  assert.deepEqual(await readFile(join(f.root, 'packages/dsh-toolbox/resources/win32-x64/all-in-one-desktop.exe')), f.windowsBinary);
  assert.deepEqual(await readFile(join(f.root, 'packages/dsh-toolbox/resources/desktop-manifest.json')), f.windowsManifest);
});

test('unsupported platforms and missing binaries fail without creating resources', async t => {
  const f = await fixture(t);

  await assert.rejects(bundleDesktopMacos({
    root: f.root,
    platform: 'darwin-universal',
    binaryPath: join(f.binaryDir, 'missing'),
    sourceRevision,
  }), /Unsupported macOS platform/);
  await assert.rejects(bundleDesktopMacos({
    root: f.root,
    platform: 'darwin-arm64',
    binaryPath: join(f.binaryDir, 'missing'),
    sourceRevision,
  }), /ENOENT/);
  await assert.rejects(stat(join(f.root, 'packages/dsh-toolbox/resources/darwin-arm64')), /ENOENT/);
});

test('packaging rejects a non-executable binary before writing resources', async t => {
  const f = await fixture(t);
  const binaryPath = join(f.binaryDir, 'not executable');
  await writeFile(binaryPath, 'synthetic');
  await chmod(binaryPath, 0o644);

  await assert.rejects(bundleDesktopMacos({
    root: f.root,
    platform: 'darwin-arm64',
    binaryPath,
    sourceRevision,
  }), /must be an executable file/);
  await assert.rejects(stat(join(f.root, 'packages/dsh-toolbox/resources/darwin-arm64')), /ENOENT/);
});

test('packaging refuses to label an Intel executable as Apple Silicon', async t => {
  const f = await fixture(t);
  const binaryPath = join(f.binaryDir, 'wrong architecture');
  await writeFile(binaryPath, syntheticMachO('x64'), { mode: 0o755 });
  await assert.rejects(bundleDesktopMacos({
    root: f.root, platform: 'darwin-arm64', binaryPath, sourceRevision,
  }), /Expected a arm64 Mach-O executable/);
  await assert.rejects(stat(join(f.root, 'packages/dsh-toolbox/resources/darwin-arm64')), /ENOENT/);
});

test('packaging rejects a bare executable without its macOS application identity', async t => {
  const f = await fixture(t);
  const binaryPath = join(f.binaryDir, 'bare binary');
  await writeFile(binaryPath, syntheticMachO('arm64'), { mode: 0o755 });
  await assert.rejects(bundleDesktopMacos({
    root: f.root, platform: 'darwin-arm64', binaryPath, sourceRevision,
  }), /must belong to its.*app bundle/);
});
