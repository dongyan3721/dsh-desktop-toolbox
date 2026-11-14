// Creates a separate, local acceptance package. Never rewrites beta.6 distribution/.
import { chmod, cp, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('Build this preview on the matching macOS target');
const root = fileURLToPath(new URL('../', import.meta.url));
const target = `darwin-${process.arch}`;
const resources = join(root, 'packages/dsh-toolbox/resources', target);
const manifest = JSON.parse(await readFile(join(resources, 'desktop-manifest.json'), 'utf8'));
const bytes = await readFile(join(resources, 'All-in-One Toolbox.app/Contents/MacOS/all-in-one-desktop'));
if (manifest.runtime !== 'desktop' || manifest.platform !== 'darwin' || manifest.architecture !== process.arch || manifest.protocolVersion !== 1
  || manifest.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Invalid macOS desktop manifest');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
pkg.version += '.macos.0';
pkg.description = 'Local macOS acceptance preview; not a published release';
pkg.os = ['darwin'];
pkg.cpu = [process.arch];
delete pkg.scripts;
const stage = await mkdtemp(join(root, '.tmp/macos-preview-'));
await mkdir(join(stage, 'distribution/resources'), { recursive: true });
await cp(join(root, 'packages/dsh-toolbox/lib'), join(stage, 'distribution/lib'), { recursive: true });
await cp(resources, join(stage, 'distribution/resources', target), { recursive: true });
const client = await readFile(join(root, 'packages/dsh-toolbox-client/client.js'), 'utf8');
const prefix = "window.__ModuleLoader__.load({\n  id: 'dsh-toolbox-client',";
if (!client.startsWith(prefix)) throw new Error('Unexpected Client module registration');
await writeFile(join(stage, 'distribution/client.js'), client.replace(prefix, "window.__ModuleLoader__.load({\n  id: 'dsh-toolbox-bundle',"));
for (const name of ['cordis.patch.yml', 'LICENSE']) await cp(join(root, name), join(stage, name));
await writeFile(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
await writeFile(join(stage, 'README.md'), 'Local macOS acceptance preview. No claim of Windows/x64, signing, updater, or complete desktop parity. See the source repository docs/MACOS_ACCEPTANCE.zh-CN.md.\n');
await writeFile(join(stage, 'distribution/provenance.json'), JSON.stringify({
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  target, nativeManifest: manifest, harnessVersion: '0.2.2-rc.3', localPreview: true,
}, null, 2) + '\n');
const output = join(root, 'artifacts/macos-preview');
await mkdir(output, { recursive: true });
execFileSync('pnpm', ['pack', '--pack-destination', output], { cwd: stage, stdio: 'inherit' });
// npm pack normalizes non-bin files to 0644. A native companion is not a CLI
// entry point, and must not need an install hook merely to restore its mode.
// Repack only our own pack output, preserving its file selection and metadata.
const archive = join(output, `${pkg.name}-${pkg.version}.tgz`);
const unpacked = await mkdtemp(join(root, '.tmp/macos-pack-mode-'));
execFileSync('tar', ['-xzf', archive, '-C', unpacked]);
await chmod(join(unpacked, 'package/distribution/resources', target, 'All-in-One Toolbox.app/Contents/MacOS/all-in-one-desktop'), 0o755);
const executableArchive = `${archive}.tmp`;
execFileSync('tar', ['-czf', executableArchive, '-C', unpacked, 'package']);
await rename(executableArchive, archive);
console.log(`Staged local preview at ${stage}`);
