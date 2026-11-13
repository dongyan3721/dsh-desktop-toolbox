// Explicit real-desktop acceptance driver. Never included in npm tests/package.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import * as Executor from '@deepseek-ai/dsh-tool-executor-native';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import Attachments from '@deepseek-ai/dsh-attachment-local';

assert.ok(process.argv.includes('--allow-desktop'), 'Real desktop tests require explicit --allow-desktop');
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = process.env.TOOLBOX_BETA_RUN_ID || randomUUID();
assert.match(runId, /^[a-zA-Z0-9-]+$/);
const base = join(root, 'runtime', 'beta-acceptance', runId);
const evidence = join(root, 'artifacts', 'beta-acceptance', runId);
const dataDir = join(base, 'toolbox-data');
await mkdir(evidence, { recursive: true });
await mkdir(dataDir, { recursive: true });
const meta = { runId, base, evidence, dataDir, home: join(base, 'harness-home') };
await writeFile(join(root, '.tmp', 'beta-run.json'), JSON.stringify(meta, null, 2));
const ctx = new Context();
let desktopEntry;
let agentEntry;
const knownTools = new Map();
const record = async value => {
  const line = JSON.stringify(value);
  console.log(line);
  await appendFile(join(evidence, 'session.jsonl'), `${line}\n`);
};
async function load() {
  const id = await ctx.loader.create({ id: 'beta-desktop', name: new URL('../packages/dsh-toolbox/lib/desktop/index.js', import.meta.url).href,
    config: { dataDir, startupTimeoutMs: 40000, requestTimeoutMs: 20000, shutdownTimeoutMs: 15000 } });
  await ctx.loader.await(); desktopEntry = ctx.loader.resolve(id); await desktopEntry.fiber.await();
  const agentId = await ctx.loader.create({ id: 'beta-agent', name: new URL('../packages/dsh-toolbox/lib/agent/index.js', import.meta.url).href });
  await ctx.loader.await(); agentEntry = ctx.loader.resolve(agentId); await agentEntry.fiber.await();
  await new Promise(resolve => setTimeout(resolve, 1200));
  await record({ event: 'loaded', ...meta, status: await ctx.get('toolboxDesktop').status(), access: await ctx.get('toolboxDesktop').getAgentAccess() });
}
async function unload() {
  if (agentEntry) { await agentEntry.fiber.dispose(); ctx.loader.remove(agentEntry.id); agentEntry = undefined; }
  if (desktopEntry) {
    const owner = ctx.get('toolboxDesktop').owner;
    await desktopEntry.fiber.dispose(); ctx.loader.remove(desktopEntry.id); desktopEntry = undefined;
    await owner.handle.waitForExit();
    await record({ event: 'unloaded', processesExited: true, remainingTools: ctx.tools.definitions().map(tool => tool.name) });
  }
}
async function fixtureAccess(command) {
  assert.equal(desktopEntry, undefined, 'Unload first; configuration fixtures are never written into a running kernel');
  const configPath = join(dataDir, 'config.json');
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch { config = { config_version: 6 }; }
  config.modules ??= {};
  const supported = ['screenshot', 'clipboard', 'screen_ink', 'app_usage', 'sticky_note'];
  const humanOnly = ['media_proc', 'window_pin', 'script_runner', 'translator', 'password_vault'];
  config.modules.enabled = Object.fromEntries([...supported, ...humanOnly].map(id => [id, command.enabled?.includes(id) === true]));
  config.modules.agent_access = Object.fromEntries(supported.map(id => [id, command.allowed?.includes(id) === true]));
  config.modules.agent_support_generation = 1;
  config.modules.settings ??= {};
  config.modules.settings.app_usage = { ...(config.modules.settings.app_usage ?? {}), keep_window_titles: false };
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await record({ event: 'fixture-access', enabled: command.enabled ?? [], allowed: command.allowed ?? [] });
}
try {
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(Executor); await ctx.plugin(Subprocess);
  await ctx.plugin(Attachments, { dshHome: meta.home });
  await ctx.plugin(Loader, { baseUrl: new URL('../package.json', import.meta.url).href });
  await load();
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const raw of lines) {
    let command;
    try {
      command = JSON.parse(raw);
      if (command.op === 'quit') { lines.close(); break; }
      if (command.op === 'unload') { await unload(); continue; }
      if (command.op === 'load') { await load(); continue; }
      if (command.op === 'fixture-access') { await fixtureAccess(command); continue; }
      const desktop = ctx.get('toolboxDesktop');
      if (command.op === 'show') { await record({ event: 'show', value: await desktop.showMain() }); continue; }
      if (command.op === 'panel') {
        assert.notEqual(command.module, 'password_vault', 'Credential UI is manual acceptance only');
        await record({ event: 'panel', module: command.module, value: await desktop.openPanel(command.module) }); continue;
      }
      if (command.op === 'access') { await record({ event: 'access', value: await desktop.getAgentAccess() }); continue; }
      if (command.op === 'tools') {
        for (const tool of ctx.tools.definitions()) knownTools.set(tool.name, tool);
        await record({ event: 'tools', names: ctx.tools.definitions().map(tool => tool.name) }); continue;
      }
      if (command.op === 'tool') {
        const batch = await ctx.tools.execute({ calls: [{ id: randomUUID(), name: command.name, arguments: JSON.stringify(command.args ?? {}) }], signal: new AbortController().signal });
        const result = batch.results[0].result;
        if (result.value?.image) {
          const imagePath = ctx.get('attachments').imageHostPath(result.value.image);
          assert.ok(isAbsolute(imagePath));
          await record({ event: 'image', path: imagePath });
        }
        await record({ event: 'tool', name: command.name, result }); continue;
      }
      if (command.op === 'call') { await record({ event: 'call', method: command.method, value: await desktop.agentCall(command.method, command.params ?? {}) }); continue; }
      if (command.op === 'old-tool') {
        const tool = knownTools.get(command.name); assert.ok(tool);
        await record({ event: 'old-tool', name: command.name, value: await tool.execute(command.args ?? {}, { signal: new AbortController().signal }) }); continue;
      }
      throw new Error('Unknown acceptance command');
    } catch (error) { await record({ event: 'error', op: command?.op, name: command?.name, code: error.code ?? error.name, message: error.message }); }
  }
} finally { try { await unload(); } finally { await ctx.fiber.dispose(); } }
