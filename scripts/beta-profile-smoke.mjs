// Explicit acceptance inside the installed Harness CLI. Uses the packaged GUI kernel.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const name = 'toolbox-beta-profile-acceptance';
export const inject = ['toolboxDesktop', 'tools'];
export function apply(ctx) {
  const exit = ctx.get('appExit');
  assert.ok(exit, 'Run through the installed Harness launcher');
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 60000);
  const work = run(ctx, abort.signal).then(
    result => { console.log(`BETA_PROFILE_ACCEPTANCE ${JSON.stringify(result)}`); exit(0); },
    error => { console.error(`BETA_PROFILE_FAILED ${error.code || error.name}: ${error.message}`); exit(1); },
  ).finally(() => clearTimeout(deadline));
  ctx.effect(() => async () => { abort.abort(); clearTimeout(deadline); await work; });
}

async function run(ctx, signal) {
  await ctx.loader.await();
  const desktop = ctx.get('toolboxDesktop');
  assert.equal((await desktop.status()).nativeConnected, true);
  await new Promise(resolve => setTimeout(resolve, 1500));
  const names = ctx.tools.definitions().map(t => t.name).filter(n => n.startsWith('toolbox_')).sort();
  if (process.env.TOOLBOX_BETA_PHASE === 'default') {
    assert.deepEqual(names, []);
    const access = await desktop.getAgentAccess();
    assert.equal(access.modules.filter(m => m.agent_supported).length, 5);
    assert.ok(access.modules.every(m => !m.agent_effective));
    await assert.rejects(desktop.agentCall('agent.notes.search', { query: 'DSH-BETA-PROFILE' }), { code: 'AGENT_ACCESS_DENIED' });
    await desktop.showMain();
    return { defaultDenied: true, supportedModules: 5, nativeConnected: true };
  }
  assert.deepEqual(names, ['toolbox_clipboard', 'toolbox_notes', 'toolbox_screen_ink', 'toolbox_screenshot', 'toolbox_usage']);
  const call = async (name, args) => {
    const batch = await ctx.tools.execute({ calls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }], signal });
    const result = batch.results[0].result;
    assert.equal(result.isError, false, JSON.stringify(result));
    return result;
  };
  let found = (await call('toolbox_notes', { action: 'search', query: 'DSH-BETA-PROFILE' })).value.items;
  if (process.env.TOOLBOX_BETA_PHASE === 'restart') {
    assert.equal(found.length, 1);
    assert.equal((await call('toolbox_notes', { action: 'read', id: found[0].id })).value.content_md, 'Beta packaged profile: 中文保存成功。');
    return { persistedAcrossRestart: true, fiveTools: names };
  }
  assert.ok(found.length <= 1);
  if (!found.length) await call('toolbox_notes', { action: 'create', title: 'DSH-BETA-PROFILE', content_md: 'Beta packaged profile: 中文保存成功。' });
  await call('toolbox_screen_ink', { action: 'start' });
  // A newly created WebView can honestly return BUSY until its original canvas
  // registers. Poll a read only operation; never retry a possibly committed draw.
  const readyDeadline = Date.now() + 15000;
  for (;;) {
    try { await desktop.agentCall('agent.ink.snapshot', {}, { signal }); break; }
    catch (error) {
      if (error.code !== 'BUSY' || Date.now() >= readyDeadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  await call('toolbox_screen_ink', { action: 'draw', strokes: [{ points: [{ x: 600, y: 350 }, { x: 850, y: 350 }], width: 8, color: '#1166EE' }] });
  const snapshot = await call('toolbox_screen_ink', { action: 'snapshot' });
  assert.ok(snapshot.content.some(c => c.type === 'image' && c.attachment?.attachmentId));
  await call('toolbox_screen_ink', { action: 'clear' });
  await call('toolbox_screen_ink', { action: 'stop' });
  return { realNotes: true, originalCanvas: true, realSdkImageAttachment: true, fiveTools: names };
}
