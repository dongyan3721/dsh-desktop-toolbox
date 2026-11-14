import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import { NativeOwner } from '../packages/dsh-toolbox/src/host/native-owner.js';
import { DESKTOP_RUNTIME } from '../packages/dsh-toolbox/src/desktop/index.js';

const configFor = dataDir => ({ dataDir, nativeExecutable: process.execPath, startupTimeoutMs: 5000, requestTimeoutMs: 1000, cancelTimeoutMs: 200, shutdownTimeoutMs: 1000 });

test('desktop service loads without tools and settles its owned protocol fixture through real subprocess/Loader', { timeout: 15000 }, async () => {
  const ctx = new Context();
  const dataDir = fileURLToPath(new URL(`../runtime/desktop-service/${randomUUID()}/`, import.meta.url));
  try {
    await ctx.plugin(LocalSubprocess);
    await ctx.plugin(Loader, { baseUrl: new URL('../package.json', import.meta.url).href });
    const id = await ctx.loader.create({ id: 'desktop-fixture', name: new URL('./fixtures/desktop-loader.mjs', import.meta.url).href, config: configFor(dataDir) });
    await ctx.loader.await();
    const entry = ctx.loader.resolve(id);
    await entry.fiber.await();
    assert.equal(ctx.get('tools'), undefined);
    const desktop = ctx.get('toolboxDesktop');
    assert.equal((await desktop.status()).nativeConnected, true);
    if (process.platform === 'darwin') {
      assert.ok(Buffer.byteLength(desktop.owner.pipePath) <= 103);
      assert.equal((await stat(dirname(desktop.owner.pipePath))).mode & 0o777, 0o700);
    }
    await desktop.showMain();
    await desktop.showMain();
    await desktop.openPanel('sticky_note');
    assert.deepEqual(await desktop.console({ action: 'snapshot', args: {} }), { fixtureAccepted: { action: 'snapshot', args: {} } });
    await assert.rejects(desktop.console({ action: 'invoke', args: { cmd: 'vault_list' } }), { code: 'INVALID_REQUEST' });
    await assert.rejects(desktop.openPanel('../../private'), { code: 'INVALID_REQUEST' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(desktop.showMain({ signal: controller.signal }), { name: 'AbortError' });
    const previousInstance = desktop.owner.instanceId;
    await desktop.owner.handle.terminate();
    await desktop.owner.outcome;
    assert.equal((await desktop.status()).nativeConnected, false);
    await assert.rejects(desktop.console({ action: 'snapshot', args: {} }), { code: 'NATIVE_UNAVAILABLE' });
    assert.equal(desktop.owner.instanceId, previousInstance, 'background reads never restart a stopped process');
    await desktop.showMain();
    assert.notEqual(desktop.owner.instanceId, previousInstance);
    const endpointDir = desktop.owner.endpointDir;
    await entry.fiber.dispose();
    if (endpointDir) await assert.rejects(stat(endpointDir), { code: 'ENOENT' });
    ctx.loader.remove(id);
    assert.equal(ctx.get('toolboxDesktop'), undefined);
    const calls = (await readFile(join(dataDir, 'fixture-calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.filter(call => call.method === 'desktop.show_main').length, 3);
    assert.deepEqual(calls.find(call => call.method === 'desktop.open_panel').params, { module_id: 'sticky_note' });
    assert.equal(calls.at(-1).method, 'desktop.shutdown');
    assert.equal(calls.filter(call => call.method === 'desktop.console').length, 1);
  } finally { await ctx.fiber.dispose(); }
});

test('desktop failed-save shutdown is reported even after bounded owned process termination', { timeout: 10000 }, async () => {
  const ctx = new Context();
  const dataDir = fileURLToPath(new URL(`../runtime/desktop-service/${randomUUID()}/`, import.meta.url));
  await mkdir(dataDir, { recursive: true });
  await ctx.plugin(LocalSubprocess);
  const owner = new NativeOwner(ctx.subprocess, { ...configFor(dataDir), tempDir: dataDir, readRoots: [], writeRoots: [] }, {
    ...DESKTOP_RUNTIME,
    flags: [fileURLToPath(new URL('./fixtures/desktop-control-child.mjs', import.meta.url)), '--toolbox-plugin', '--shutdown-fails'],
  });
  try {
    await owner.start();
    await assert.rejects(owner.close(), { code: 'DESKTOP_SHUTDOWN_FAILED' });
    await owner.handle.waitForExit();
  } finally { await owner.close().catch(() => {}); await ctx.fiber.dispose(); }
});
