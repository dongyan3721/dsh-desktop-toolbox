import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'native/YourAllIn1Helper'], { cwd: root });
const binary = join(root, 'build/rust/target/release/dsh-toolbox-native.exe');
const destination = new URL('../packages/dsh-toolbox/resources/win32-x64/', import.meta.url);
await mkdir(destination, { recursive: true });
const bytes = await readFile(binary);
await cp(binary, new URL('dsh-toolbox-native.exe', destination));
const nativeSourceRevision = execFileSync('git', ['log', '-1', '--format=%H', '--', 'native/YourAllIn1Helper'], { cwd: root, encoding: 'utf8' }).trim();
const pkg = JSON.parse(await readFile(new URL('../packages/dsh-toolbox/package.json', import.meta.url), 'utf8'));
await writeFile(new URL('../packages/dsh-toolbox/resources/native-manifest.json', import.meta.url), `${JSON.stringify({ pluginVersion: pkg.version, harnessVersion: pkg.peerDependencies['@deepseek-ai/dsh-tools'], protocolVersion: 1, platform: 'win32', architecture: 'x64', nativeSourceRevision, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2)}\n`);
console.log('Bundled native executable with integrity manifest');
