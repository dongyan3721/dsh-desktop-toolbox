// Run with the installed Harness Electron in ELECTRON_RUN_AS_NODE=1 mode.
// Reads only application files, never the user's Harness home.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules';
const destination = path.join(root, 'vendor/harness-runtime/node_modules');
const visited = new Set();
const copied = [];
function copy(source, target) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(target, name));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}
function extract(name, required = true) {
  if (visited.has(name)) return;
  const source = path.join(base, name);
  if (!fs.existsSync(path.join(source, 'package.json'))) {
    if (required) throw new Error(`Installed SDK dependency missing: ${name}`);
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
for (const name of ['cordis', 'schemastery', 'cordis-plugin-loader', 'dsh-tools', 'dsh-system-prompt', 'dsh-tool-executor-native', 'dsh-subprocess-local', 'dsh-fs-local', 'dsh-fs-sandbox', 'dsh-sandbox-policy', 'dsh-session-projection', 'dsh-attachment-local']) extract(`@deepseek-ai/${name}`);
for (const suffix of ['dsh-client-connection', 'dsh-client-ui-sidebar', 'dsh-tool-fs']) {
  const name = `@deepseek-ai/${suffix}`;
  extract(name);
  const reference = path.join(root, 'vendor/harness-reference', name);
  if (!fs.existsSync(reference)) copy(path.join(base, name), reference);
}
const link = path.join(root, 'node_modules');
if (!fs.existsSync(link)) fs.symlinkSync(path.relative(root, destination), link, 'dir');
else if (!fs.lstatSync(link).isSymbolicLink() || fs.realpathSync(link) !== fs.realpathSync(destination)) throw new Error('Refusing to replace existing node_modules');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/macos-sdk.json'), JSON.stringify({ source: base, node: process.version, platform: process.platform, architecture: process.arch, packages: copied }, null, 2) + '\n');
console.log(`Prepared ${visited.size} installed SDK packages (read-only source; workspace-local copy)`);
