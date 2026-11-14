// Fixtures for owned, workspace-local acceptance only. Not part of the bundle.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const [caseName, profileArg, phase = 'prepare'] = process.argv.slice(2);
assert.match(caseName, /^[a-z0-9-]+$/);
assert.ok(['prepare', 'usage-fixture'].includes(phase));
const profile = await realpath(resolve(profileArg));
assert.ok(!isAbsolute(relative(root, profile)) && !relative(root, profile).startsWith('..') && relative(root, profile) !== '');
const dataDir = join(root, 'runtime/beta8', caseName, 'toolbox-data');
if (phase === 'usage-fixture') {
  const path = join(dataDir, 'config.json');
  const c = JSON.parse(await readFile(path));
  assert.ok(Object.values(c.modules.agent_access ?? {}).every(value => !value));
  c.modules.settings ??= {};
  c.modules.settings.app_usage = { ...(c.modules.settings.app_usage ?? {}), keep_window_titles: false, idle_threshold_secs: 86400, flush_interval_secs: 5, audio_afk_exception: false };
  await writeFile(path, JSON.stringify(c, null, 2));
} else {
  await mkdir(join(root, 'runtime/beta8'), { recursive: true });
  await writeFile(join(root, 'runtime/beta8/package.json'), JSON.stringify({ name: 'toolbox-acceptance-scope', private: true, type: 'module' }));
  await writeFile(join(profile, 'acceptance.patch.yml'), JSON.stringify([
    { id: 'toolbox-desktop', config: { dataDir } },
    { insert: [{ id: 'unified-acceptance', name: pathToFileURL(join(root, 'scripts/unified-install-acceptance.mjs')).href }] },
  ], null, 2));
}
console.log(`Prepared ${phase} for ${caseName}`);
