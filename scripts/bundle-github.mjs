import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));

async function filesUnder(directory, prefix = '') {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error(`Linked input/output is not allowed: ${directory}`);
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    const path = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Linked input/output is not allowed: ${path}`);
    if (item.isDirectory()) files.push(...await filesUnder(path, name));
    else if (item.isFile()) files.push(name);
    else throw new Error(`Unsupported filesystem entry: ${path}`);
  }
  return files.sort();
}

function validatePackage(pkg) {
  if (pkg.name !== 'dsh-toolbox-bundle' || !pkg.version) throw new Error('Unexpected complete Bundle manifest');
  if (Object.keys(pkg.dependencies ?? {}).length) throw new Error('The complete Bundle must not need dependency downloads');
  for (const hook of ['prepare', 'prepack', 'prepublish', 'preinstall', 'install', 'postinstall']) {
    if (pkg.scripts?.[hook]) throw new Error(`Installation hook is not allowed: ${hook}`);
  }
  if (pkg.dsh?.client?.platform !== 'web' || pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('Missing Bundle/Client declaration');
}

async function validateNative(resources, version) {
  const sources = {};
  for (const [name, binary, runtime] of [
    ['desktop-manifest.json', 'all-in-one-desktop.exe', 'desktop'],
    ['native-manifest.json', 'dsh-toolbox-native.exe', undefined],
  ]) {
    const manifest = await json(join(resources, name));
    const bytes = await readFile(join(resources, 'win32-x64', binary));
    if (manifest.pluginVersion !== version || manifest.platform !== 'win32' || manifest.architecture !== 'x64'
      || manifest.protocolVersion !== 1 || manifest.runtime !== runtime || manifest.sha256 !== sha256(bytes)
      || !/^[a-f0-9]{40}$/.test(manifest.nativeSourceRevision)) throw new Error(`Invalid native integrity manifest: ${name}`);
    sources[binary] = manifest.nativeSourceRevision;
  }
  return sources;
}

export async function verifyGithubBundle(root = workspace) {
  root = resolve(root);
  const pkg = await json(join(root, 'package.json'));
  validatePackage(pkg);
  const directory = join(root, 'distribution');
  const manifest = await json(join(directory, 'manifest.json'));
  if (manifest.format !== 1 || manifest.version !== pkg.version || manifest.packageName !== pkg.name
    || !/^[a-f0-9]{40}$/.test(manifest.sourceRevision)) throw new Error('Invalid distribution provenance');
  const actualNames = (await filesUnder(directory)).filter(name => name !== 'manifest.json');
  if (JSON.stringify(actualNames) !== JSON.stringify(manifest.files?.map(file => file.path))) throw new Error('Distribution file inventory mismatch');
  for (const file of manifest.files) {
    const bytes = await readFile(join(directory, file.path));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Distribution integrity mismatch: ${file.path}`);
  }
  await validateNative(join(directory, 'resources'), pkg.version);
  for (const entry of Object.values(pkg.exports)) {
    if (typeof entry !== 'string' || !entry.startsWith('./')) throw new Error('Unsupported Bundle export');
    await lstat(join(root, entry));
  }
  const client = await readFile(join(directory, 'client.js'), 'utf8');
  if (!client.startsWith(`window.__ModuleLoader__.load({\n  id: '${pkg.name}',`)) throw new Error('Client registration does not match the installed package');
  return manifest;
}

export async function buildGithubBundle({ root = workspace, sourceRevision } = {}) {
  root = resolve(root);
  const pkg = await json(join(root, 'package.json'));
  const hostRoot = join(root, 'packages/dsh-toolbox');
  const clientRoot = join(root, 'packages/dsh-toolbox-client');
  const host = await json(join(hostRoot, 'package.json'));
  const client = await json(join(clientRoot, 'package.json'));
  validatePackage(pkg);
  if (host.version !== pkg.version || client.version !== pkg.version || client.peerDependencies?.['dsh-toolbox'] !== pkg.version) throw new Error('Release versions must match');
  if (JSON.stringify(pkg.peerDependencies) !== JSON.stringify(host.peerDependencies)) throw new Error('Host and complete Bundle peer requirements must match');
  for (const input of [join(hostRoot, 'lib'), join(hostRoot, 'resources')]) await filesUnder(input);
  const nativeSources = await validateNative(join(hostRoot, 'resources'), pkg.version);
  const originalClient = (await readFile(join(clientRoot, 'client.js'), 'utf8')).replaceAll('\r\n', '\n');
  const originalPrefix = "window.__ModuleLoader__.load({\n  id: 'dsh-toolbox-client',";
  if (!originalClient.startsWith(originalPrefix)) throw new Error('Unexpected Client registration format');
  if (sourceRevision === undefined) {
    execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'package.json', 'cordis.patch.yml', 'packages/dsh-toolbox', 'packages/dsh-toolbox-client', 'native/YourAllIn1Helper', 'scripts/bundle-github.mjs'], { cwd: root });
    sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  }
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('Invalid source revision');
  const destination = join(root, 'distribution');
  const current = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (current?.isSymbolicLink()) throw new Error('Refusing to replace a linked distribution directory');
  const stage = join(root, '.tmp', `github-bundle-${randomUUID()}`);
  await mkdir(stage, { recursive: true });
  try {
    await cp(join(hostRoot, 'lib'), join(stage, 'lib'), { recursive: true });
    await cp(join(hostRoot, 'resources'), join(stage, 'resources'), { recursive: true });
    await writeFile(join(stage, 'client.js'), originalClient.replace(originalPrefix, `window.__ModuleLoader__.load({\n  id: '${pkg.name}',`));
    const files = [];
    for (const name of await filesUnder(stage)) {
      const bytes = await readFile(join(stage, name));
      files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const manifest = { format: 1, packageName: pkg.name, version: pkg.version, sourceRevision, nativeSources, files };
    await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // This fixed output stays beneath the checked workspace; never remove a junction.
    if (relative(root, destination) !== 'distribution' || dirname(destination) !== root) throw new Error('Invalid distribution destination');
    if (current) { await filesUnder(destination); await rm(destination, { recursive: true }); }
    await rename(stage, destination);
    await verifyGithubBundle(root);
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = process.argv.includes('--verify') ? await verifyGithubBundle() : await buildGithubBundle();
  console.log(`Complete Bundle ${manifest.version}: ${manifest.files.length} verified runtime files (source ${manifest.sourceRevision})`);
}
