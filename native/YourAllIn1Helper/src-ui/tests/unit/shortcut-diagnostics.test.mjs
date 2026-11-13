import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../../src/utils/shortcutDiagnostics.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../../src/components/PreferencesPanel.vue', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(ts.transpileModule(source.replace(/export /g, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
const run = expression => vm.runInContext(expression, context);

function present(check) {
  context.check = check;
  return JSON.parse(run(`JSON.stringify(presentShortcutRow({
    spec: { module_id: 'clipboard', action_id: 'clipboard:toggle_popup', description: 'Clipboard popup' },
    displayLabel: 'Ctrl + Alt + D',
    activeHotkey: 'Ctrl+Alt+D',
    check,
    moduleLabel: id => id,
    actionLabel: spec => spec.description || spec.action_id,
    disabledLabel: 'off'
  }))`));
}

test('classification covers occupation, denial, reservation, invalid input, cleanup, and an unknown holder', () => {
  const occupied = present({
    status: 'os_unavailable',
    physical_accelerator: 'Ctrl+Shift+A',
    display_label: 'Ctrl + Shift + A',
    detail: 'HotKey already registered: HotKey { mods: (CONTROL | SHIFT), key: KeyA }',
  });
  assert.equal(occupied.category, 'registration_occupied');
  assert.equal(occupied.osErrorCode, 1409);
  assert.equal(occupied.owner, null);
  assert.equal(occupied.ownerRow, 'unknown');
  assert.equal(occupied.showDetails, true);
  assert.match(occupied.raw, /HotKey already registered/);
  assert.ok(occupied.suggestionKeys.includes('desktop.diagnosis.suggestionText.common_tools'));
  assert.equal(occupied.summaryParams.action, 'Clipboard popup');

  const denied = present({ status: 'os_unavailable', detail: 'Access is denied. (os error 5)', physical_accelerator: 'Ctrl+Alt+P' });
  assert.equal(denied.category, 'system_denied');
  assert.equal(denied.osErrorCode, 5);
  assert.equal(denied.owner, null);
  assert.deepEqual(denied.suggestionKeys, []);

  const reserved = present({ status: 'os_unavailable', detail: 'HotKey already registered', physical_accelerator: 'F12', display_label: 'F12' });
  assert.equal(reserved.category, 'system_reserved');
  assert.equal(reserved.owner, null);
  assert.ok(reserved.guidanceKeys.includes('desktop.diagnosis.guidanceText.reserved_f12'));

  const invalid = present({ status: 'invalid', hotkey: 'bad+expression', detail: 'Multiple non-modifier keys' });
  assert.equal(invalid.category, 'invalid_combo');
  assert.equal(invalid.owner, null);

  const explicitWins = present({ status: 'os_unavailable', detail: 'Access is denied. (os error 5). HotKey already registered', physical_accelerator: 'Ctrl+Alt+P' });
  assert.equal(explicitWins.category, 'system_denied');
  assert.equal(explicitWins.osErrorCode, 5);
  const modifiedF12 = present({ status: 'os_unavailable', detail: 'HotKey already registered', physical_accelerator: 'Ctrl+F12' });
  assert.equal(modifiedF12.category, 'registration_occupied');
  const notChecked = present({ status: 'not_checked', physical_accelerator: 'Ctrl+Alt+D', display_label: 'Ctrl + Alt + D' });
  assert.equal(notChecked.category, 'not_checked');
  assert.equal(notChecked.owner, null);
  assert.equal(notChecked.showDetails, true);

  const cleanup = present({
    status: 'probe_error',
    detail: 'Temporary shortcut cleanup failed: cleanup failed; cleanup failed',
    physical_accelerator: 'F8',
  });
  assert.equal(cleanup.category, 'probe_failed');
  assert.equal(cleanup.owner, null);
  assert.ok(cleanup.guidanceKeys.includes('desktop.diagnosis.guidanceText.cleanup_failed'));
  assert.equal(cleanup.suggestionKeys.length, 0);
});

test('raw text that names a program or pid does not become a confirmed owner', () => {
  const guessed = present({
    status: 'os_unavailable',
    detail: 'foreground ShareX pid 4242 C:\\Users\\private\\ShareX.exe',
    physical_accelerator: 'Ctrl+Alt+D',
  });
  assert.equal(guessed.category, 'unknown_system_failure');
  assert.equal(guessed.owner, null);
  assert.equal(guessed.ownerRow, 'unknown');
  assert.equal(guessed.suggestionKeys.length, 0);
  assert.match(guessed.raw, /ShareX/);

  const pathOwner = present({
    status: 'os_unavailable',
    detail: 'HotKey already registered',
    physical_accelerator: 'Ctrl+Alt+D',
    diagnosis: { category: 'registration_occupied', os_error_code: 1409, owner: { pid: 9, program: 'C:\\Windows\\notepad.exe' }, guidance: ['owner_unknown'], suggestions: [] },
  });
  assert.equal(pathOwner.owner, null);
  assert.equal(pathOwner.ownerRow, 'unknown');

  const confirmed = present({
    status: 'os_unavailable',
    detail: 'HotKey already registered',
    diagnosis: { category: 'registration_occupied', os_error_code: 1409, owner: { pid: 42, program: 'notepad.exe' }, guidance: ['owner_unknown'], suggestions: ['app_settings'] },
  });
  assert.deepEqual(confirmed.owner, { pid: 42, program: 'notepad.exe' });
  assert.equal(confirmed.ownerRow, 'confirmed');
});

test('internal conflicts name the module, action, and script from the payload', () => {
  const view = JSON.parse(run(`JSON.stringify(presentShortcutRow({
    spec: { module_id: 'media_proc', action_id: 'media_proc:open_panel', description: 'Open' },
    displayLabel: 'Ctrl + Shift + F12',
    check: {
      status: 'internal_conflict',
      display_label: 'Ctrl + Shift + F12',
      conflicts: [
        { spec: { module_id: 'screenshot', action_id: 'screenshot:capture', description: 'Capture' }, enabled: false },
        { spec: { module_id: 'script_runner', action_id: 'script:run:7', description: '运行脚本 QA' }, enabled: true }
      ]
    },
    moduleLabel: id => id,
    actionLabel: spec => spec.description,
    disabledLabel: 'off'
  }))`));
  assert.equal(view.category, 'internal_conflict');
  assert.equal(view.owner, null);
  assert.deepEqual(view.subjectLines, [
    'screenshot · Capture (screenshot:capture) (off)',
    'script_runner · 运行脚本 QA (script:run:7)',
  ]);
  assert.match(view.summaryParams.names, /script:run:7/);
  assert.match(view.summaryParams.names, /运行脚本 QA/);
});

test('a stored registration error stays explainable when no fresh check exists', () => {
  const view = JSON.parse(run(`JSON.stringify(presentShortcutRow({
    spec: { module_id: 'clipboard', action_id: 'clipboard:toggle_popup', description: 'Clipboard popup' },
    displayLabel: 'Ctrl + Alt + D',
    nativeError: 'Ctrl+Alt+D：HotKey already registered: demo',
    moduleLabel: id => id,
    actionLabel: spec => spec.description
  }))`));
  assert.equal(view.visible, true);
  assert.equal(view.category, 'registration_occupied');
  assert.equal(view.osErrorCode, 1409);
  assert.equal(view.owner, null);
  assert.equal(view.raw, 'Ctrl+Alt+D：HotKey already registered: demo');
  assert.equal(view.summaryParams.combo, 'Ctrl + Alt + D');
});

test('the preferences panel exposes details and recheck without hiding the error in a title', () => {
  assert.match(panel, /desktop\.diagnosis\.recheck/);
  assert.match(panel, /desktop\.diagnosis\.showDetails/);
  assert.match(panel, /<details/);
  assert.match(panel, /<summary>/);
  assert.doesNotMatch(panel, /:title="[^"]*detail/);
  assert.doesNotMatch(panel, /:title="shortcut\.native_error"/);
});
