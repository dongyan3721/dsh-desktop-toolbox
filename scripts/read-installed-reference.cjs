const fs = require('node:fs');
const path = require('node:path');
const source = 'E:/deepseek-harness/resources/app.asar/dsh/node_modules';
const destination = path.join(fs.realpathSync(path.resolve(__dirname, '../vendor')), 'harness-reference');
function copy(from, to) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry));
  } else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, fs.readFileSync(from)); }
}
for (const name of process.argv.slice(2)) {
  if (!/^@deepseek-ai\/[a-z0-9-]+$/.test(name)) throw new Error('Invalid package name');
  for (const item of ['README.md', 'package.json', 'lib']) {
    const file = path.join(source, name, item);
    if (fs.existsSync(file)) copy(file, path.join(destination, name, item));
  }
  console.log(`Read installed reference ${name}`);
}
