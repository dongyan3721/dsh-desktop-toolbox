const fs = require('node:fs');
const path = require('node:path');
const base = 'E:/deepseek-harness/resources/app.asar/dsh/node_modules';
const names = fs.readdirSync(path.join(base, '@deepseek-ai'));
const selected = ['@deepseek-ai/cordis','@deepseek-ai/dsh-tools','@deepseek-ai/schemastery','@deepseek-ai/dsh-desktop-host','@deepseek-ai/dsh-cli','@deepseek-ai/dsh-base'];
const result = {node:process.version, packages:[], available:names};
for (const name of selected) {
  const file = path.join(base,name,'package.json');
  if (!fs.existsSync(file)) continue;
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  result.packages.push({name,version:manifest.version,main:manifest.main,exports:manifest.exports,engines:manifest.engines,files:fs.readdirSync(path.join(base,name))});
}
fs.writeFileSync(path.join(process.env.DSH_TOOLBOX_WORKSPACE,'artifacts/harness-runtime.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,available:result.available.length},null,2));
function copyTree(source,destination) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination,{recursive:true});
    for (const entry of fs.readdirSync(source)) copyTree(path.join(source,entry),path.join(destination,entry));
  } else {
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.writeFileSync(destination,fs.readFileSync(source));
  }
}
if (process.argv.includes('--reference')) {
  for (const name of [...selected,'@deepseek-ai/cordis-plugin-loader','@deepseek-ai/dsh-subprocess','@deepseek-ai/dsh-tool-jobs']) {
    const directory=path.join(base,name);
    if (!fs.existsSync(directory)) continue;
    const destination=path.join(process.env.DSH_TOOLBOX_WORKSPACE,'vendor/harness-reference',name);
    fs.mkdirSync(destination,{recursive:true});
    for (const item of ['package.json','README.md','README.zh.md','lib/types','src']) {
      const source=path.join(directory,item);
      if (fs.existsSync(source)) copyTree(source,path.join(destination,item));
    }
  }
  const tools=fs.readFileSync(path.join(base,'@deepseek-ai/dsh-tools/lib/index.js'),'utf8');
  const offset=tools.indexOf('function defineTool');
  console.log('DEFINE_TOOL_IMPLEMENTATION:',tools.slice(offset,offset+2200));
}
if (process.argv.includes('--extract-sdk')) {
  const visited=new Set();
  function extract(name) {
    if(visited.has(name)) return;
    visited.add(name);
    const directory=path.join(base,name);
    const manifestPath=path.join(directory,'package.json');
    if(!fs.existsSync(manifestPath)) throw new Error('Missing installed SDK package '+name);
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    const destination=path.join(process.env.DSH_TOOLBOX_WORKSPACE,'vendor/harness-runtime/node_modules',name);
    copyTree(directory,destination);
    for(const dependency of Object.keys(manifest.dependencies||{})) extract(dependency);
    for(const peer of Object.keys(manifest.peerDependencies||{})) {
      if(fs.existsSync(path.join(base,peer,'package.json'))) extract(peer);
    }
  }
  for(const name of ['@deepseek-ai/cordis','@deepseek-ai/dsh-tools','@deepseek-ai/schemastery','@deepseek-ai/cordis-plugin-loader','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tool-executor-native']) extract(name);
  console.log('EXTRACTED_SDK_PACKAGES:',visited.size);
}
