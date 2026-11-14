// Controlled acceptance driver; never included in the installed product.
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { verifyGithubBundle } from './bundle-github.mjs';

export const name = 'toolbox-beta6-install-acceptance';
export const inject = ['toolboxDesktop', 'tools', 'clientModules'];
export function apply(ctx) {
  const exit = ctx.get('appExit');
  assert.equal(typeof exit, 'function', 'Run through the installed Harness launcher');
  const work = (async () => {
    await ctx.loader.await();
    const desktop = ctx.get('toolboxDesktop');
    assert.equal((await desktop.status()).nativeConnected, true);
    const access = await desktop.getAgentAccess();
    assert.equal(access.modules.filter(module => module.agent_supported).length, 5);
    assert.ok(access.modules.every(module => !module.agent_effective));
    assert.deepEqual(ctx.tools.definitions().map(tool => tool.name).filter(name => name.startsWith('toolbox_')), []);
    await assert.rejects(desktop.agentCall('agent.notes.search', { query: 'beta.6' }), { code: 'AGENT_ACCESS_DENIED' });
    const browser = ctx.get('clientModules');
    assert.equal(browser.graph().entries.filter(entry => entry.id === 'dsh-toolbox-bundle').length, 1);
    assert.ok(!browser.graph().entries.some(entry => entry.id === 'dsh-toolbox-client'));
    const client = browser.clientPath('dsh-toolbox-bundle');
    assert.ok(client, 'The actual Host must discover the complete package Client half');
    const manifest = await verifyGithubBundle(dirname(dirname(client)));
    console.log(`BETA6_INSTALL_ACCEPTANCE ${JSON.stringify({ version: manifest.version, sourceRevision: manifest.sourceRevision, runtimeFiles: manifest.files.length, nativeConnected: true, clientPackages: 1, defaultDeniedModules: 5 })}`);
  })();
  work.then(() => exit(0), error => {
    console.error(`BETA6_INSTALL_FAILED ${error.code ?? error.name}: ${error.message}`);
    exit(1);
  });
  ctx.effect(() => async () => { await work.catch(() => {}); });
}
