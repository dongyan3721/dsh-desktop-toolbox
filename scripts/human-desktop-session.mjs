// Explicit, interactive acceptance driver. Not included in npm test or the product.
// Opens the real bundled Tauri executable; it never simulates UI or native IPC.
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';

const run = JSON.parse(await readFile(process.argv[2] ?? new URL('../.tmp/h1-run.json', import.meta.url), 'utf8'));
const ctx = new Context();
let entry;
let lastInstance;
async function log(value) {
  const line = JSON.stringify(value);
  console.log(line);
  await appendFile(join(run.artifacts, 'native-session.jsonl'), `${line}\n`);
}
async function load() {
  const id = await ctx.loader.create({
    id: 'human-desktop-acceptance',
    name: new URL('../packages/dsh-toolbox/lib/desktop/index.js', import.meta.url).href,
    config: { dataDir: run.data, startupTimeoutMs: 30000 },
  });
  await ctx.loader.await();
  entry = ctx.loader.resolve(id);
  assert.ok(entry?.fiber);
  await entry.fiber.await();
  const desktop = ctx.get('toolboxDesktop');
  assert.ok(desktop);
  assert.equal(ctx.get('tools'), undefined);
  assert.equal((await desktop.status()).nativeConnected, true);
  if (lastInstance) assert.notEqual(desktop.owner.instanceId, lastInstance);
  lastInstance = desktop.owner.instanceId;
  await log({ event: 'loaded', instance: lastInstance, withoutModelTools: true });
}
async function unload() {
  if (!entry) return;
  const owner = ctx.get('toolboxDesktop').owner;
  await entry.fiber.dispose();
  ctx.loader.remove(entry.id);
  entry = undefined;
  assert.equal(ctx.get('toolboxDesktop'), undefined);
  await owner.handle.waitForExit();
  await log({ event: 'unloaded', ownedProcessExited: true });
}
try {
  await ctx.plugin(LocalSubprocess);
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(join(process.cwd(), 'package.json')).href });
  await load();
  console.log('Commands: status, show, panel, unload, reload, quit');
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const raw of lines) {
    const command = raw.trim();
    try {
      if (command === 'quit') { lines.close(); break; }
      if (command === 'unload') { await unload(); continue; }
      if (command === 'reload') { await unload(); await load(); continue; }
      const desktop = ctx.get('toolboxDesktop');
      if (!desktop) throw new Error('Desktop is unloaded');
      const value = command === 'status' ? await desktop.status()
        : command === 'show' ? await desktop.showMain()
        : command === 'panel' ? await desktop.openPanel('sticky_note')
        : undefined;
      if (value === undefined) throw new Error('Unknown acceptance command');
      await log({ command, value });
    } catch (error) { await log({ command, error: error.code ?? error.name, message: error.message }); }
  }
} finally {
  await unload();
  await ctx.fiber.dispose();
}
