// Runs as an explicit local test plugin in the real installed Harness launcher.
// Not included in the released package. Never run against a personal profile.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { verifyGithubBundle } from './bundle-github.mjs';

export const name = 'toolbox-beta7-macos-acceptance';
export const inject = ['toolboxDesktop', 'tools', 'clientModules'];
const modules = ['screenshot', 'clipboard', 'screen_ink', 'sticky_note', 'app_usage'];
const tools = { screenshot: 'toolbox_screenshot', clipboard: 'toolbox_clipboard', screen_ink: 'toolbox_screen_ink', sticky_note: 'toolbox_notes', app_usage: 'toolbox_usage' };
const probes = { screenshot: ['agent.screenshot.monitors', {}], clipboard: ['agent.clipboard.list', { keyword: 'BETA7-MAC' }], screen_ink: ['agent.ink.status', {}], sticky_note: ['agent.notes.search', { query: 'BETA7-MAC' }], app_usage: ['agent.usage.status', {}] };
const argumentsFor = { screenshot: { action: 'monitors' }, clipboard: { action: 'list', keyword: 'BETA7-MAC' }, screen_ink: { action: 'status' }, sticky_note: { action: 'search', query: 'BETA7-MAC' }, app_usage: { action: 'status' } };

export function apply(ctx) {
  const exit = ctx.get('appExit');
  assert.equal(typeof exit, 'function');
  const work = run(ctx);
  work.then(() => exit(0), error => { console.error(`BETA7_ACCEPTANCE_FAILED ${error.stack}`); exit(1); });
  ctx.effect(() => async () => { await work.catch(() => {}); });
}

async function run(ctx) {
  assert.equal(process.platform, 'darwin');
  const workspace = process.env.DSH_TOOLBOX_WORKSPACE;
  assert.ok(workspace);
  const phase = process.env.TOOLBOX_BETA7_PHASE ?? 'default';
  assert.ok(['default', 'enabled', 'persisted'].includes(phase));
  const desktop = ctx.get('toolboxDesktop');
  const dataDir = resolve(desktop.config.dataDir);
  assert.ok(dataDir.startsWith(join(workspace, 'runtime/beta7') + sep), 'Acceptance is restricted to dedicated beta7 data');
  const evidence = join(workspace, 'artifacts/beta7');
  await mkdir(evidence, { recursive: true });
  const record = async value => {
    const line = JSON.stringify({ phase, at: new Date().toISOString(), ...value });
    console.log(`BETA7_ACCEPTANCE ${line}`);
    await appendFile(join(evidence, 'acceptance.jsonl'), line + '\n');
  };
  const waitFor = async (fn, message, duration = 15000) => {
    const until = Date.now() + duration;
    for (;;) { const value = await fn(); if (value) return value; assert.ok(Date.now() < until, message); await sleep(100); }
  };
  const names = () => ctx.tools.definitions().map(t => t.name).filter(n => n.startsWith('toolbox_')).sort();
  const consoleCall = (action, args) => desktop.console({ action, args });
  const grant = (moduleId, allowed) => consoleCall('setAgentAccess', { moduleId, allowed });
  const enable = (moduleId, enabled) => consoleCall('setModuleEnabled', { moduleId, enabled });
  const tool = async (name, args) => {
    const batch = await ctx.tools.execute({ calls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }], signal: AbortSignal.timeout(30000) });
    const result = batch.results[0].result;
    assert.equal(result.isError, false, JSON.stringify(result));
    return result;
  };
  await ctx.loader.await();
  assert.equal((await desktop.status()).nativeConnected, true);
  const client = ctx.get('clientModules');
  assert.equal(client.graph().entries.filter(e => e.id === 'dsh-toolbox-bundle').length, 1);
  assert.ok(!client.graph().entries.some(e => e.id === 'dsh-toolbox-client'));
  const packageRoot = dirname(dirname(client.clientPath('dsh-toolbox-bundle')));
  const manifest = await verifyGithubBundle(packageRoot);
  assert.equal(manifest.version, '0.1.0-beta.7');
  const access = await desktop.getAgentAccess();
  assert.deepEqual(access.modules.filter(m => m.agent_supported).map(m => m.id).sort(), [...modules].sort());
  assert.ok(access.modules.every(m => !m.agent_allowed && !m.agent_effective));
  await sleep(1200);
  assert.deepEqual(names(), []);
  for (const id of modules) {
    await assert.rejects(desktop.agentCall(...probes[id]), { code: 'AGENT_ACCESS_DENIED' });
  }
  await record({ event: 'installed-default-deny', version: manifest.version, sourceRevision: manifest.sourceRevision, dataDir, runtimeFiles: manifest.files.length, nativeConnected: true, clientPackages: 1 });
  if (phase === 'default') return;

  if (phase === 'persisted') {
    await enable('sticky_note', true); await grant('sticky_note', true);
    await waitFor(() => names().includes('toolbox_notes'), 'Notes tool not registered');
    const items = (await tool('toolbox_notes', { action: 'search', query: 'BETA7-MAC-NOTE' })).value.items;
    assert.equal(items.length, 1);
    assert.equal((await tool('toolbox_notes', { action: 'read', id: items[0].id })).value.content_md, 'BETA7-MAC persisted 中文与 Emoji 🧪');
    await grant('sticky_note', false);
    await record({ event: 'persisted-after-restart', noteId: items[0].id });
    return;
  }

  const config = JSON.parse(await readFile(join(dataDir, 'config.json')));
  assert.equal(config.modules.settings.app_usage.keep_window_titles, false);
  assert.equal(config.modules.settings.app_usage.flush_interval_secs, 5);
  assert.equal(config.modules.settings.app_usage.idle_threshold_secs, 86400);
  // These are test-only user settings; production idle defaults remain unchanged.
  for (const id of modules) {
    await enable(id, true);
    assert.equal((await desktop.getAgentAccess()).modules.find(m => m.id === id).agent_allowed, false);
    await grant(id, true);
    await waitFor(() => names().includes(tools[id]), `${id} tool not registered`);
  }
  assert.deepEqual(names(), Object.values(tools).sort());
  const remembered = new Map(ctx.tools.definitions().map(t => [t.name, t]));
  const monitorResult = (await tool('toolbox_screenshot', { action: 'monitors' })).value;
  assert.equal(monitorResult.synthetic, false);
  const monitor = monitorResult.monitors.find(m => m.is_primary) ?? monitorResult.monitors[0];
  const screenshot = await tool('toolbox_screenshot', { action: 'capture', monitor_id: monitor.id, region: { x: 0, y: 0, width: 32, height: 32 } });
  assert.ok(screenshot.content.some(c => c.type === 'image' && c.attachment?.attachmentId));
  assert.equal(screenshot.value.image.width, 32);
  await record({ event: 'screenshot', physicalMonitor: monitor, imageAttachment: true });

  const text = 'BETA7-MAC-CLIPBOARD 中文与 Emoji 🧪';
  const write = (await tool('toolbox_clipboard', { action: 'write_text', text })).value;
  assert.equal(write.backend, 'os');
  assert.equal((await tool('toolbox_clipboard', { action: 'read_text', id: write.id })).value.text, text);
  assert.ok((await tool('toolbox_clipboard', { action: 'list', keyword: 'BETA7-MAC-CLIPBOARD' })).value.items.some(i => i.id === write.id));
  await record({ event: 'clipboard', osBackend: true, sharedHistory: true });

  const created = (await tool('toolbox_notes', { action: 'create', title: 'BETA7-MAC-NOTE', content_md: 'BETA7-MAC initial' })).value;
  const note = created.note ?? created;
  assert.ok(note.id);
  await tool('toolbox_notes', { action: 'open', id: note.id });
  const opened = await waitFor(async () => {
    try { return await desktop.agentCall('agent.notes.read', { id: note.id }); }
    catch (error) { if (['UNAVAILABLE', 'BUSY'].includes(error.code)) return false; throw error; }
  }, 'Original note editor did not become ready');
  const updated = (await tool('toolbox_notes', { action: 'update', id: note.id, expected_updated_at: opened.updated_at, content_md: 'BETA7-MAC persisted 中文与 Emoji 🧪' })).value;
  assert.equal(updated.display_sync, 'applied');
  assert.equal((await tool('toolbox_notes', { action: 'read', id: note.id })).value.content_md, 'BETA7-MAC persisted 中文与 Emoji 🧪');
  await record({ event: 'notes', noteId: note.id, originalWindowSynchronized: true });

  await tool('toolbox_screen_ink', { action: 'start' });
  await waitFor(async () => {
    try { await desktop.agentCall('agent.ink.snapshot', {}); return true; }
    catch (error) { if (['UNAVAILABLE', 'BUSY'].includes(error.code)) return false; throw error; }
  }, 'Original ink canvas did not become ready');
  const points = [{ x: monitor.x + monitor.width * 0.75, y: monitor.y + monitor.height * 0.75 }, { x: monitor.x + monitor.width * 0.85, y: monitor.y + monitor.height * 0.85 }];
  const drawn = (await tool('toolbox_screen_ink', { action: 'draw', strokes: [{ points, color: '#00AAFF', width: 8 }] })).value;
  assert.equal(drawn.applied, 1);
  await tool('toolbox_screen_ink', { action: 'passthrough', enabled: true });
  const snapshot = await tool('toolbox_screen_ink', { action: 'snapshot' });
  assert.ok(snapshot.content.some(c => c.type === 'image' && c.attachment?.attachmentId));
  await tool('toolbox_screen_ink', { action: 'clear' });
  await tool('toolbox_screen_ink', { action: 'stop' });
  await record({ event: 'screen-ink', physicalPoints: points, applied: drawn.applied, originalCanvas: true, imageAttachment: true });

  const date = new Intl.DateTimeFormat('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const usage = () => tool('toolbox_usage', { action: 'overview', start_date: date, end_date: date });
  const before = (await usage()).value.total_seconds;
  const after = await waitFor(async () => { const value = (await usage()).value; return value.total_seconds > before ? value : false; }, 'Real app usage did not increase', 20000);
  const hourly = (await tool('toolbox_usage', { action: 'hourly', date })).value;
  assert.ok(hourly.total_seconds >= after.total_seconds);
  await record({ event: 'app-usage', realSampler: true, beforeSeconds: before, afterSeconds: after.total_seconds, windowTitlesStored: false });

  for (const id of modules) {
    const old = remembered.get(tools[id]); assert.ok(old);
    await grant(id, false);
    await waitFor(() => !names().includes(tools[id]), `${id} revoke did not withdraw tool`);
    await assert.rejects(old.execute(argumentsFor[id], { signal: new AbortController().signal }), { code: 'AGENT_ACCESS_DENIED' });
    await assert.rejects(desktop.agentCall(...probes[id]), { code: 'AGENT_ACCESS_DENIED' });
    await grant(id, true); await enable(id, false);
    const disabled = (await desktop.getAgentAccess()).modules.find(m => m.id === id);
    assert.equal(disabled.agent_allowed, true); assert.equal(disabled.agent_effective, false);
    await assert.rejects(desktop.agentCall(...probes[id]), { code: 'MODULE_DISABLED' });
    await grant(id, false);
    await record({ event: 'grant-boundary', module: id, revokedOldReferenceDenied: true, disabledPreservesGrant: true });
  }
  assert.deepEqual(names(), []);
  await enable('sticky_note', true);
  await record({ event: 'five-module-acceptance-passed' });
}
