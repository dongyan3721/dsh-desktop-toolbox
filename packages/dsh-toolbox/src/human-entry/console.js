const MODULES = new Set(['screenshot', 'clipboard', 'screen_ink', 'sticky_note', 'app_usage', 'media_proc', 'window_pin', 'script_runner', 'translator', 'password_vault']);
const AGENT_MODULES = new Set(['screenshot', 'clipboard', 'screen_ink', 'sticky_note', 'app_usage']);
function invalid() { const error = new Error('Invalid toolbox console request'); error.code = 'INVALID_REQUEST'; throw error; }
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value;
}
function text(value, max) {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)) invalid();
}
/** Closed human-only commands. Never forward arbitrary kernel/Agent IPC. */
export function validateConsoleRequest(payload) {
  const value = record(payload, ['action', 'args']);
  const { action } = value;
  const args = value.args;
  switch (action) {
    case 'snapshot': case 'reconnect': case 'getShortcutPreferences': case 'checkAllShortcuts': case 'openManual':
      record(args, []); break;
    case 'setModuleEnabled': case 'setAgentAccess': {
      const grant = action === 'setAgentAccess';
      record(args, ['moduleId', grant ? 'allowed' : 'enabled']);
      if (!(grant ? AGENT_MODULES : MODULES).has(args.moduleId) || typeof args[grant ? 'allowed' : 'enabled'] !== 'boolean') invalid();
      break;
    }
    case 'checkShortcut': case 'updateShortcut':
      record(args, ['actionId', 'hotkey']); text(args.actionId, 160);
      if (args.hotkey !== null) { if (args.hotkey !== '') text(args.hotkey, 128); }
      break;
    case 'updateGeneral':
      record(args, ['language', 'theme']);
      if (!Object.keys(args).length || (Object.hasOwn(args, 'language') && !['zh-CN', 'en-US', 'ja-JP'].includes(args.language))
        || (Object.hasOwn(args, 'theme') && !['light', 'dark', 'system'].includes(args.theme))) invalid();
      break;
    default: invalid();
  }
  return { action, args: { ...args } };
}
