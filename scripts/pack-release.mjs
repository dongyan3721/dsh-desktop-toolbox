// Pack the already-built complete bundle; never build/download at install time.
import { chmod, mkdir, mkdtemp, readFile, rename, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGithubBundle } from './bundle-github.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = await verifyGithubBundle(root);
const pkg = JSON.parse(await readFile(join(root, 'package.json')));
const output = resolve(root, process.argv[2] ?? 'dist');
if (relative(root, output).startsWith('..') || relative(root, output).startsWith('/')) throw new Error('Release output must stay in the workspace');
await mkdir(output, { recursive: true });
const filename = `${pkg.name}-${pkg.version}.tgz`;
const archive = join(output, filename);
if (await stat(archive).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; })) throw new Error(`Release archive already exists: ${archive}`);
const stage = await mkdtemp(join(root, '.tmp/release-pack-'));
execFileSync('pnpm', ['pack', '--pack-destination', stage], { cwd: root, stdio: 'inherit' });
const packed = join(stage, filename);
if (manifest.files.some(file => file.executable)) {
  const unpacked = join(stage, 'unpacked');
  await mkdir(unpacked);
  execFileSync('tar', ['-xzf', packed, '-C', unpacked]);
  for (const file of manifest.files) if (file.executable) await chmod(join(unpacked, 'package/distribution', file.path), 0o755);
  // Only repack our own npm-selected payload. Avoid macOS metadata sidecars.
  execFileSync('tar', ['-czf', packed, '-C', unpacked, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
}
await rename(packed, archive);
console.log(`Release archive: ${archive}`);
