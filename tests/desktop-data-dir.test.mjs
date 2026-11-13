import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolveDesktopDataDir } from '../packages/dsh-toolbox/src/desktop/data-dir.js';
import { Config } from '../packages/dsh-toolbox/src/desktop/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const home = join(root, 'runtime', 'default-home-fixture');

test('desktop defaults use Harness home without requiring launcher environment', () => {
  assert.equal(Config({}).dataDir, '');
  assert.equal(resolveDesktopDataDir(undefined, {}, home), join(home, '.dsh', 'toolbox-desktop-data'));
  assert.equal(resolveDesktopDataDir('', {}, home), join(home, '.dsh', 'toolbox-desktop-data'));
  assert.equal(resolveDesktopDataDir('', { DSH_HOME: join(home, 'custom') }, home), join(home, 'custom', 'toolbox-desktop-data'));
  assert.equal(resolveDesktopDataDir('', { DSH_HOME: '~/custom' }, home), join(home, 'custom', 'toolbox-desktop-data'));
  assert.equal(resolveDesktopDataDir('', { DSH_HOME: '~' }, home), join(home, 'toolbox-desktop-data'));
  assert.equal(resolveDesktopDataDir('', { DSH_HOME: 'relative-home' }, home), join(resolve('relative-home'), 'toolbox-desktop-data'));
});

test('desktop explicit directories retain precedence and relative overrides are rejected', () => {
  const configured = join(home, 'configured');
  const environment = join(home, 'environment');
  assert.equal(resolveDesktopDataDir(configured, { DSH_TOOLBOX_DATA_DIR: environment }, home), configured);
  assert.equal(resolveDesktopDataDir('', { DSH_TOOLBOX_DATA_DIR: environment }, home), environment);
  for (const relative of ['relative-data', './data']) {
    assert.throws(() => resolveDesktopDataDir(relative, {}, home), { code: 'INVALID_CONFIG' });
    assert.throws(() => resolveDesktopDataDir('', { DSH_TOOLBOX_DATA_DIR: relative }, home), { code: 'INVALID_CONFIG' });
  }
});

test('real Loader starts and stops the desktop protocol fixture with no dataDir or DSH environment', { timeout: 15000 }, async () => {
  const fakeHome = join(root, 'runtime', 'default-profile', randomUUID());
  const env = { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome };
  delete env.DSH_HOME;
  delete env.DSH_TOOLBOX_DATA_DIR;
  const code = `
    import assert from 'node:assert/strict';
    import { homedir } from 'node:os';
    import { join } from 'node:path';
    import { Context } from '@deepseek-ai/cordis';
    import Loader from '@deepseek-ai/cordis-plugin-loader';
    import Subprocess from '@deepseek-ai/dsh-subprocess-local';
    assert.equal(homedir(), process.env.USERPROFILE, 'Keep every generated file inside the D-drive fixture');
    const ctx = new Context();
    try {
      await ctx.plugin(Subprocess);
      await ctx.plugin(Loader, { baseUrl: new URL('./package.json', import.meta.url).href });
      const id = await ctx.loader.create({ id: 'default-desktop', name: new URL('./tests/fixtures/desktop-loader.mjs', import.meta.url).href, config: { nativeExecutable: process.execPath } });
      await ctx.loader.await();
      const entry = ctx.loader.resolve(id); await entry.fiber.await();
      const desktop = ctx.get('toolboxDesktop');
      assert.equal(desktop.config.dataDir, join(homedir(), '.dsh', 'toolbox-desktop-data'));
      assert.equal((await desktop.status()).nativeConnected, true);
      await desktop.showMain();
      const owner = desktop.owner;
      await entry.fiber.dispose(); await owner.handle.waitForExit();
      console.log('DEFAULT_DESKTOP_OK');
    } finally { await ctx.fiber.dispose(); }
  `;
  assert.ok(isAbsolute(fakeHome));
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env, timeout: 12000 });
  assert.match(stdout, /DEFAULT_DESKTOP_OK/);
});
