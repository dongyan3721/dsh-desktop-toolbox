// Run with the installed Electron in ELECTRON_RUN_AS_NODE mode.
const fs = require('node:fs');
const path = require('node:path');
const base = 'E:/deepseek-harness/resources/app.asar/dsh/node_modules';
const destinationRoot = path.join(fs.realpathSync(path.resolve(__dirname, '../vendor')), 'harness-runtime/node_modules');
if (!destinationRoot.toLowerCase().startsWith('d:\\code\\dsh-toolbox\\')) throw new Error('SDK destination escaped the project');
const visited = new Set();
function copy(source, destination) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(destination, name));
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, fs.readFileSync(source));
  }
}
function extract(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const directory = path.join(base, name);
  if (!fs.existsSync(path.join(directory, 'package.json'))) throw new Error(`Missing installed package ${name}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const target = path.join(destinationRoot, name);
  if (!fs.existsSync(target)) copy(directory, target);
  for (const dependency of Object.keys(manifest.dependencies || {})) extract(dependency);
  for (const peer of Object.keys(manifest.peerDependencies || {})) {
    if (fs.existsSync(path.join(base, peer, 'package.json'))) extract(peer);
  }
}
const additional = process.argv.slice(2);
if (additional.some(name => !/^@deepseek-ai\/[a-z0-9-]+$/.test(name))) throw new Error('Invalid additional SDK package');
for (const name of ['@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-fs', '@deepseek-ai/dsh-fs-local', '@deepseek-ai/dsh-sandbox', '@deepseek-ai/dsh-fs-sandbox', '@deepseek-ai/dsh-sandbox-policy', ...additional]) extract(name);
console.log(`Verified ${visited.size} process/filesystem SDK packages in ${destinationRoot}`);
