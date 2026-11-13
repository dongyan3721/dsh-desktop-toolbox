// Read-only verification of the fictional note entered through the real GUI.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const run = JSON.parse(await readFile(process.argv[2] ?? new URL('../.tmp/h1-run.json', import.meta.url), 'utf8'));
const db = new DatabaseSync(join(run.data, 'app.db'), { readOnly: true });
try {
  const rows = db.prepare('SELECT title, content_md FROM sticky_notes WHERE title = ?').all('H1 集成验收便笺');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content_md, 'H1 human-first fixture — 中文与 Markdown **保存成功**。\n重启后仍应保留此正文。');
  const config = JSON.parse(await readFile(join(run.data, 'config.json'), 'utf8'));
  assert.equal(config.shortcut_overrides['sticky_note:create'] ?? null, null);
  assert.equal(config.shortcut_overrides['sticky_note:open_panel'] ?? null, null);
  for (const [module, enabled] of Object.entries(config.modules.enabled)) assert.equal(enabled, module === 'sticky_note');
  const result = { realGuiNotePersisted: true, exactUnicodeAndMarkdown: true, shortcutsRestored: true, onlyNotesEnabled: true };
  await writeFile(join(run.artifacts, 'fixture-verification.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally { db.close(); }
