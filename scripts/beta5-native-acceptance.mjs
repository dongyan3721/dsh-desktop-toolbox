// Explicit real OS acceptance with synthetic clipboard content and an isolated DB.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
assert.ok(process.argv.includes('--allow-desktop'), 'Explicit --allow-desktop is required');
const root = fileURLToPath(new URL('../', import.meta.url));
const run = join(root, 'runtime', 'beta5-acceptance', randomUUID());
const dataDir = join(run, 'toolbox-data');
const evidence = join(root, 'artifacts', 'beta5-native-acceptance');
await mkdir(evidence, { recursive: true });
const fixtureDir = join(root, 'runtime', 'beta5-fixture');
await mkdir(fixtureDir, { recursive: true });
const controlFile = join(fixtureDir, `${randomUUID()}.json`);
const fixture = spawn('pwsh', ['-NoProfile', '-File', join(root, 'scripts/windows-beta5-fixture.ps1'), '-AllowDesktop', '-ControlFile', controlFile], { cwd: root, windowsHide: true });
let output = '';
fixture.stdout.on('data', bytes => { output += bytes; });
fixture.stderr.on('data', bytes => { output += bytes; });
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 20000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timeout: ${label}; fixture: ${output.slice(-1200)}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
};
async function fixtureAction(action) {
  const marker = output.length;
  await writeFile(`${controlFile}.next`, JSON.stringify({ action, id: randomUUID() }));
  await rename(`${controlFile}.next`, controlFile);
  if (action !== 'quit') await waitFor(() => output.slice(marker).includes(`BETA5_FIXTURE_DONE ${action}`), action);
}
const ctx = new Context();
let entry;
const proof = { run, dataDir };
async function load() {
  const id = await ctx.loader.create({ id: 'beta5-native', name: new URL('../packages/dsh-toolbox/lib/desktop/index.js', import.meta.url).href,
    config: { dataDir, startupTimeoutMs: 40000, requestTimeoutMs: 15000, shutdownTimeoutMs: 15000 } });
  await ctx.loader.await(); entry = ctx.loader.resolve(id); await entry.fiber.await();
  return ctx.get('toolboxDesktop');
}
async function unload() {
  if (!entry) return;
  const owner = ctx.get('toolboxDesktop').owner;
  await entry.fiber.dispose(); ctx.loader.remove(entry.id); entry = undefined;
  await owner.handle.waitForExit();
}
try {
  await waitFor(() => output.includes('BETA5_FIXTURE_READY'), 'fixture startup');
  await ctx.plugin(Subprocess); await ctx.plugin(Loader, { baseUrl: new URL('../package.json', import.meta.url).href });
  let desktop = await load();
  const consoleCall = (action, args = {}) => desktop.console({ action, args });
  const initial = await consoleCall('snapshot');
  assert.equal(initial.module_catalog.length, 10);
  assert.ok(initial.module_catalog.every(row => !row.agent_allowed));
  assert.equal(initial.foreground_external_window, undefined);
  await assert.rejects(desktop.agentCall('desktop.console', { action: 'snapshot', args: {} }));
  await assert.rejects(desktop.agentCall('agent.clipboard.list', {}));
  proof.defaultAgentDenied = true;
  await consoleCall('checkShortcut', { actionId: 'sticky_note:create', hotkey: 'Ctrl+Alt+Shift+F10' });
  await fixtureAction('hold-key');
  const occupied = await consoleCall('checkShortcut', { actionId: 'sticky_note:create', hotkey: 'Ctrl+Alt+Shift+F10' });
  assert.equal(occupied.diagnosis.category, 'registration_occupied'); assert.equal(occupied.diagnosis.os_error_code, 1409); assert.equal(occupied.diagnosis.owner, null);
  await fixtureAction('release-key');
  assert.equal((await consoleCall('checkShortcut', { actionId: 'sticky_note:create', hotkey: 'Ctrl+Alt+Shift+F10' })).status, 'available');
  await consoleCall('updateShortcut', { actionId: 'sticky_note:create', hotkey: 'Ctrl+Alt+Shift+F10' });
  await consoleCall('updateShortcut', { actionId: 'sticky_note:create', hotkey: null });
  proof.realHotkeyOccupiedAndReleased = true;
  await consoleCall('setModuleEnabled', { moduleId: 'clipboard', enabled: true });
  await new Promise(resolve => setTimeout(resolve, 700));
  await fixtureAction('text');
  const db = new DatabaseSync(join(dataDir, 'app.db'), { readOnly: true });
  try {
    await waitFor(() => db.prepare('SELECT id FROM clipboard_items WHERE content_text = ?').get('DSH-BETA5-SOURCE synthetic text'), 'text capture');
    const text = db.prepare('SELECT source_app_name, updated_at FROM clipboard_items WHERE content_text = ?').get('DSH-BETA5-SOURCE synthetic text');
    assert.equal(text.source_app_name.toLowerCase(), 'pwsh');
    await fixtureAction('text');
    await waitFor(() => db.prepare('SELECT updated_at FROM clipboard_items WHERE content_text = ?').get('DSH-BETA5-SOURCE synthetic text').updated_at > text.updated_at, 'duplicate clipboard sequence refresh');
    await fixtureAction('image');
    await waitFor(() => db.prepare("SELECT source_app_name FROM clipboard_items WHERE item_type = 'image'").get(), 'image capture');
    const image = db.prepare("SELECT source_app_name FROM clipboard_items WHERE item_type = 'image'").get();
    assert.equal(image.source_app_name.toLowerCase(), 'pwsh');
    proof.realTextAndImageOwner = 'pwsh'; proof.repeatedCopyRefreshes = true;
  } finally { db.close(); }
  await consoleCall('setAgentAccess', { moduleId: 'clipboard', allowed: true });
  const found = await desktop.agentCall('agent.clipboard.list', { keyword: 'pwsh', limit: 20 });
  assert.ok(JSON.stringify(found).includes('DSH-BETA5-SOURCE'));
  await consoleCall('setAgentAccess', { moduleId: 'clipboard', allowed: false });
  await assert.rejects(desktop.agentCall('agent.clipboard.list', {}));
  await consoleCall('setModuleEnabled', { moduleId: 'clipboard', enabled: false });
  proof.sourceSearchAndRevoke = true;
  await consoleCall('updateGeneral', { language: 'en-US', theme: 'dark' });
  assert.equal((await consoleCall('snapshot')).config.general.language, 'en-US');
  await unload(); desktop = await load();
  const restored = await consoleCall('snapshot');
  assert.equal(restored.config.general.theme, 'dark');
  assert.ok(restored.module_catalog.every(row => !row.agent_allowed));
  await consoleCall('updateGeneral', { language: 'zh-CN', theme: 'light' });
  await unload(); proof.restartPersistenceAndGracefulUnload = true;
  await writeFile(join(evidence, 'result.json'), JSON.stringify(proof, null, 2));
  console.log(`BETA5_NATIVE_ACCEPTANCE ${JSON.stringify(proof)}`);
} finally {
  await unload().catch(() => {}); await ctx.fiber.dispose();
  await fixtureAction('quit').catch(() => {});
  await new Promise(resolve => { if (fixture.exitCode !== null) return resolve(); fixture.once('exit', resolve); setTimeout(() => { fixture.kill(); resolve(); }, 2000).unref(); });
  await writeFile(join(evidence, 'fixture.log'), output);
}
