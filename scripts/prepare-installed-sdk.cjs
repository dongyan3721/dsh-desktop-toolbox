// Run using the read-only official Harness Electron with ELECTRON_RUN_AS_NODE=1.
// Extract SDK code only; never inspect profile credentials or personal data.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = process.env.DSH_HARNESS_APP_DIR;
if (!app || !path.isAbsolute(app)) throw new Error('Set absolute DSH_HARNESS_APP_DIR');
const resources = process.platform === 'darwin' ? path.join(app, 'Contents/Resources') : path.join(app, 'resources');
const base = path.join(resources, 'app.asar/dsh/node_modules');
const destination = path.join(root, 'vendor/harness-runtime/node_modules');
const copied = [];
const visited = new Set();
function copy(source, target) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(target, name));
  } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
}
function extract(name, required = true) {
  if (visited.has(name)) return;
  const source = path.join(base, name);
  if (!fs.existsSync(path.join(source, 'package.json'))) {
    if (required) throw new Error(`SDK dependency missing: ${name}`);
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const matches = (values, actual) => !Array.isArray(values) || (!values.includes(`!${actual}`) && (values.every(v => v.startsWith('!')) || values.includes(actual)));
  if (!matches(pkg.os, process.platform) || !matches(pkg.cpu, process.arch)) return;
  visited.add(name);
  const target = path.join(destination, name);
  if (!fs.existsSync(target)) copy(source, target);
  copied.push({ name, version: pkg.version });
  for (const dep of Object.keys(pkg.dependencies || {})) extract(dep);
  for (const dep of Object.keys(pkg.peerDependencies || {})) extract(dep, false);
  for (const dep of Object.keys(pkg.optionalDependencies || {})) extract(dep, false);
}
for (const suffix of ['cordis','schemastery','cordis-plugin-loader','dsh-tools','dsh-system-prompt','dsh-tool-executor-native','dsh-subprocess-local','dsh-fs-local','dsh-fs-sandbox','dsh-sandbox-policy','dsh-session-projection','dsh-attachment-local','dsh-client-connection','dsh-client-ui-sidebar','dsh-tool-fs']) extract(`@deepseek-ai/${suffix}`);
for (const suffix of ['dsh-client-connection', 'dsh-client-ui-sidebar', 'dsh-tool-fs']) {
  const name = `@deepseek-ai/${suffix}`;
  const target = path.join(root, 'vendor/harness-reference', name);
  if (!fs.existsSync(target)) copy(path.join(base, name), target);
}
const link = path.join(root, 'node_modules');
if (!fs.existsSync(link)) fs.symlinkSync(destination, link, process.platform === 'win32' ? 'junction' : 'dir');
else if (!fs.lstatSync(link).isSymbolicLink() || fs.realpathSync(link) !== fs.realpathSync(destination)) throw new Error('Refusing to replace existing node_modules');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const appManifest = JSON.parse(fs.readFileSync(path.join(resources, 'app.asar/package.json')));
fs.writeFileSync(path.join(root, 'artifacts/installed-sdk.json'), JSON.stringify({ harnessVersion: appManifest.version, node: process.version, platform: process.platform, architecture: process.arch, packages: copied }, null, 2) + '\n');
console.log(`Prepared ${visited.size} SDK packages from official Harness ${appManifest.version}`);
