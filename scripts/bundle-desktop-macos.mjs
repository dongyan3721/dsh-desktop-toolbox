import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const targets = new Map([
  ['darwin-arm64', 'arm64'],
  ['darwin-x64', 'x64'],
]);

function nativeSourceRevision(root) {
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'native/YourAllIn1Helper'], { cwd: root });
  return execFileSync('git', ['log', '-1', '--format=%H', '--', 'native/YourAllIn1Helper'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

export async function bundleDesktopMacos({
  root = projectRoot,
  platform,
  binaryPath,
  sourceRevision,
}) {
  const architecture = targets.get(platform);
  if (!architecture) throw new Error(`Unsupported macOS platform: ${platform}`);

  const packageRoot = resolve(root, 'packages/dsh-toolbox');
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const harnessVersion = pkg.peerDependencies?.['@deepseek-ai/dsh-subprocess'];
  if (typeof pkg.version !== 'string' || typeof harnessVersion !== 'string') {
    throw new Error('Host package metadata is missing its version or Harness compatibility range');
  }

  const binary = resolve(root, binaryPath);
  const binaryStat = await stat(binary);
  if (!binaryStat.isFile() || (binaryStat.mode & 0o111) === 0) {
    throw new Error(`macOS desktop binary must be an executable file: ${binary}`);
  }
  const bytes = await readFile(binary);
  if (bytes.length === 0) throw new Error(`macOS desktop binary is empty: ${binary}`);
  const cpuType = architecture === 'arm64' ? 0x0100000c : 0x01000007;
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== cpuType || bytes.readUInt32LE(12) !== 2) {
    throw new Error(`Expected a ${architecture} Mach-O executable: ${binary}`);
  }
  const appBundle = resolve(binary, '../../..');
  if (basename(appBundle) !== 'All-in-One Toolbox.app' || binary !== join(appBundle, 'Contents/MacOS/all-in-one-desktop')) {
    throw new Error('macOS desktop executable must belong to its All-in-One Toolbox.app bundle');
  }
  await readFile(join(appBundle, 'Contents/Info.plist'));

  const revision = sourceRevision ?? nativeSourceRevision(root);
  if (!/^[\da-f]{40,64}$/i.test(revision)) {
    throw new Error(`Invalid native source revision: ${revision}`);
  }

  const resourceDir = join(packageRoot, 'resources', platform);
  const existing = await lstat(resourceDir).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (existing?.isSymbolicLink()) throw new Error(`Refusing to write through linked resource directory: ${resourceDir}`);
  await mkdir(resourceDir, { recursive: true });

  const outputApp = join(resourceDir, 'All-in-One Toolbox.app');
  const outputManifest = join(resourceDir, 'desktop-manifest.json');
  const suffix = `${process.pid}-${randomUUID()}`;
  const stagedApp = join(resourceDir, `.All-in-One-Toolbox-${suffix}.tmp`);
  const stagedManifest = join(resourceDir, `.desktop-manifest-${suffix}.tmp`);
  const manifest = {
    runtime: 'desktop',
    pluginVersion: pkg.version,
    harnessVersion,
    protocolVersion: 1,
    platform: 'darwin',
    architecture,
    nativeSourceRevision: revision,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };

  try {
    await cp(appBundle, stagedApp, { recursive: true });
    await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(outputApp, { recursive: true, force: true });
    await rename(stagedApp, outputApp);
    await rename(stagedManifest, outputManifest);
    await rm(join(resourceDir, 'all-in-one-desktop'), { force: true });
  } finally {
    await rm(stagedApp, { recursive: true, force: true });
    await rm(stagedManifest, { force: true });
  }

  return manifest;
}

async function main() {
  const [, , platform, binaryPath] = process.argv;
  if (!platform || !binaryPath || process.argv.length !== 4) {
    throw new Error('Usage: node scripts/bundle-desktop-macos.mjs darwin-arm64|darwin-x64 <binary-path>');
  }
  const manifest = await bundleDesktopMacos({ platform, binaryPath });
  console.log(`Bundled ${platform} desktop executable (${manifest.sha256})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
