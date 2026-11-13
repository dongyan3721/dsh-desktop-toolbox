/** Wire types and presentation for shortcut conflict diagnosis.
 * Windows does not return the process that owns a RegisterHotKey binding.
 * `owner` is shown only when the payload itself contains a confirmed pid and a
 * bare program name. Text in the raw error is never parsed into an owner.
 */

export interface ShortcutSpecRef {
  module_id: string;
  action_id: string;
  description?: string;
}

export interface InternalSubject {
  module_id: string;
  action_id: string;
  description: string;
  enabled: boolean;
  kind: 'module_action' | 'script';
}

export interface ConfirmedOwner {
  pid: number;
  program: string;
}

export interface ShortcutDiagnosisWire {
  category?: string;
  os_error_code?: number | null;
  owner?: unknown;
  guidance?: unknown;
  suggestions?: unknown;
  subjects?: unknown;
}

export interface ShortcutConflictWire {
  spec?: ShortcutSpecRef;
  enabled?: boolean;
  display_label?: string;
}

export interface ShortcutCheckWire {
  action_id?: string;
  hotkey?: string;
  display_label?: string;
  physical_accelerator?: string;
  status?: string;
  conflicts?: ShortcutConflictWire[];
  detail?: string | null;
  diagnosis?: ShortcutDiagnosisWire | null;
}

export interface ClassifiedFailure {
  category: string;
  osErrorCode: number | null;
  guidance: string[];
  suggestions: string[];
}

export interface ShortcutPresentation {
  visible: boolean;
  blocked: boolean;
  available: boolean;
  summaryKey: string;
  summaryParams: Record<string, string | number>;
  category: string;
  categoryKnown: boolean;
  categoryKey: string;
  combo: string;
  actionLabel: string;
  actionId: string;
  osErrorCode: number | null;
  owner: ConfirmedOwner | null;
  ownerRow: 'hidden' | 'unknown' | 'confirmed';
  raw: string;
  guidanceKeys: string[];
  suggestionKeys: string[];
  subjectLines: string[];
  showDetails: boolean;
}

const CATEGORIES = new Set([
  'internal_conflict',
  'invalid_combo',
  'system_reserved',
  'system_denied',
  'registration_occupied',
  'probe_failed',
  'not_checked',
  'unknown_system_failure',
  'available',
  'unassigned',
]);

const GUIDANCE = new Set([
  'owner_unknown',
  'recheck',
  'change_combo',
  'probe_failed',
  'cleanup_failed',
  'not_checked',
  'system_denied',
  'invalid',
  'reserved_f12',
  'unknown_failure',
  'internal',
]);

const SUGGESTIONS = new Set(['app_settings', 'common_tools', 'windows_key']);

const BLOCKING = new Set(['internal_conflict', 'os_unavailable', 'invalid', 'probe_error']);

const OWNER_CATEGORIES = new Set([
  'registration_occupied',
  'system_reserved',
  'system_denied',
  'unknown_system_failure',
  'probe_failed',
  'not_checked',
]);

const PROGRAM_NAME = /^[^\\/:*?"<>|\r\n]{1,128}$/;

export function isBlockingStatus(status: string | undefined): boolean {
  return !!status && BLOCKING.has(status);
}

export function explicitOsError(detail: string): number | null {
  const matches = detail.matchAll(/os error (\d+)/gi);
  let last: number | null = null;
  for (const match of matches) {
    const code = Number(match[1]);
    if (Number.isInteger(code)) last = code;
  }
  return last;
}

export function splitStoredNativeError(stored: string): { accelerator: string; detail: string } {
  const index = stored.indexOf('：');
  if (index >= 0) {
    return { accelerator: stored.slice(0, index).trim(), detail: stored.slice(index + 1).trim() };
  }
  return { accelerator: '', detail: stored.trim() };
}

export function confirmedOwner(value: unknown): ConfirmedOwner | null {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const pid = record.pid;
  const program = record.program;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff) return null;
  if (typeof program !== 'string') return null;
  const name = program.trim();
  if (!PROGRAM_NAME.test(name) || name.includes('..')) return null;
  return { pid, program: name };
}

export function classifyRegistrationFailure(detail: string, accelerator: string, probeFailed: boolean): ClassifiedFailure {
  if (probeFailed) {
    const cleanup = detail.toLowerCase().includes('cleanup failed');
    return {
      category: 'probe_failed',
      osErrorCode: explicitOsError(detail),
      guidance: cleanup ? ['probe_failed', 'cleanup_failed', 'recheck'] : ['probe_failed', 'recheck'],
      suggestions: [],
    };
  }
  let code = explicitOsError(detail);
  if (code == null && indicatesAlreadyRegistered(detail)) code = 1409;
  if (isBareF12(accelerator)) {
    return { category: 'system_reserved', osErrorCode: code, guidance: ['reserved_f12', 'owner_unknown', 'change_combo'], suggestions: [] };
  }
  const win = usesWindowsKey(accelerator);
  if (code === 1409) {
    return {
      category: 'registration_occupied',
      osErrorCode: 1409,
      guidance: ['owner_unknown', 'recheck', 'change_combo'],
      suggestions: win ? ['app_settings', 'common_tools', 'windows_key'] : ['app_settings', 'common_tools'],
    };
  }
  if (code === 5) {
    return {
      category: 'system_denied',
      osErrorCode: 5,
      guidance: ['system_denied', 'owner_unknown', 'change_combo', 'recheck'],
      suggestions: win ? ['windows_key'] : [],
    };
  }
  if (code === 87) {
    return { category: 'invalid_combo', osErrorCode: 87, guidance: ['invalid', 'change_combo'], suggestions: [] };
  }
  return {
    category: 'unknown_system_failure',
    osErrorCode: code,
    guidance: ['unknown_failure', 'owner_unknown', 'recheck', 'change_combo'],
    suggestions: win ? ['windows_key'] : [],
  };
}

export function subjectsFromConflicts(conflicts: ShortcutConflictWire[] | undefined): InternalSubject[] {
  const subjects: InternalSubject[] = [];
  for (const row of conflicts || []) {
    const moduleId = row.spec?.module_id || '';
    const actionId = row.spec?.action_id || '';
    if (!moduleId || !actionId) continue;
    const kind = moduleId === 'script_runner' || actionId.startsWith('script:') ? 'script' : 'module_action';
    subjects.push({
      module_id: moduleId,
      action_id: actionId,
      description: row.spec?.description || '',
      enabled: row.enabled === true,
      kind,
    });
  }
  return subjects;
}

export function presentShortcutRow(input: {
  spec: ShortcutSpecRef;
  displayLabel?: string;
  activeHotkey?: string;
  nativeError?: string | null;
  storedDiagnosis?: ShortcutDiagnosisWire | null;
  check?: ShortcutCheckWire | null;
  moduleLabel: (moduleId: string) => string;
  actionLabel: (spec: ShortcutSpecRef) => string;
  disabledLabel?: string;
}): ShortcutPresentation {
  const actionLabel = input.actionLabel(input.spec);
  const actionId = input.spec.action_id;
  const check = input.check;
  const nativeError = input.nativeError?.trim() ? input.nativeError : '';
  const status = check?.status || '';
  const useCheck = !!status && status !== 'unassigned';
  if (!useCheck && !nativeError) return emptyPresentation(actionLabel, actionId);

  let accelerator = check?.physical_accelerator || '';
  let raw = typeof check?.detail === 'string' ? check.detail : '';
  let effectiveStatus = status;
  let diagnosis = check?.diagnosis || null;
  let conflicts = check?.conflicts;
  if (!useCheck) {
    const split = splitStoredNativeError(nativeError);
    accelerator = split.accelerator || accelerator;
    raw = nativeError;
    effectiveStatus = split.detail.includes('Temporary shortcut cleanup failed') ? 'probe_error' : 'os_unavailable';
    diagnosis = input.storedDiagnosis || null;
    conflicts = [];
  }
  const combo = firstText(check?.display_label, input.displayLabel, check?.hotkey, input.activeHotkey, accelerator, input.spec.action_id);
  const derived = deriveDiagnosis(effectiveStatus, raw, accelerator, conflicts, diagnosis);
  const subjectLines = derived.subjects.map(subject => subjectLine(subject, input.moduleLabel, input.actionLabel, input.disabledLabel || ''));
  const categoryKnown = CATEGORIES.has(derived.category);
  const summaryKey = derived.category === 'registration_occupied' && derived.osErrorCode == null
    ? 'desktop.diagnosis.summary.registration_occupied_no_code'
    : categoryKnown
      ? `desktop.diagnosis.summary.${derived.category}`
      : 'desktop.diagnosis.summary.unknown_system_failure';
  const owner = derived.owner;
  const ownerRow = owner ? 'confirmed' : OWNER_CATEGORIES.has(derived.category) ? 'unknown' : 'hidden';
  return {
    visible: true,
    blocked: isBlockingStatus(effectiveStatus) || ['internal_conflict', 'invalid_combo', 'system_reserved', 'system_denied', 'registration_occupied', 'probe_failed', 'unknown_system_failure'].includes(derived.category),
    available: derived.category === 'available',
    summaryKey,
    summaryParams: {
      combo,
      action: actionLabel,
      names: subjectLines.join(' / '),
      code: derived.osErrorCode ?? '',
    },
    category: derived.category,
    categoryKnown,
    categoryKey: `desktop.diagnosis.categories.${derived.category}`,
    combo,
    actionLabel,
    actionId,
    osErrorCode: derived.osErrorCode,
    owner,
    ownerRow,
    raw,
    guidanceKeys: derived.guidance.map(code => `desktop.diagnosis.guidanceText.${code}`),
    suggestionKeys: derived.suggestions.map(code => `desktop.diagnosis.suggestionText.${code}`),
    subjectLines,
    showDetails: derived.category !== 'available' && derived.category !== 'unassigned',
  };
}

function deriveDiagnosis(
  status: string,
  raw: string,
  accelerator: string,
  conflicts: ShortcutConflictWire[] | undefined,
  diagnosis: ShortcutDiagnosisWire | null,
): { category: string; osErrorCode: number | null; owner: ConfirmedOwner | null; guidance: string[]; suggestions: string[]; subjects: InternalSubject[] } {
  const owner = confirmedOwner(diagnosis?.owner);
  if (diagnosis && typeof diagnosis.category === 'string' && CATEGORIES.has(diagnosis.category)) {
    const subjects = subjectsFromDiagnosis(diagnosis.subjects);
    return {
      category: diagnosis.category,
      osErrorCode: typeof diagnosis.os_error_code === 'number' ? diagnosis.os_error_code : null,
      owner,
      guidance: stringCodes(diagnosis.guidance, GUIDANCE),
      suggestions: stringCodes(diagnosis.suggestions, SUGGESTIONS),
      subjects: subjects.length ? subjects : subjectsFromConflicts(conflicts),
    };
  }
  if (status === 'internal_conflict') {
    return { category: 'internal_conflict', osErrorCode: null, owner: null, guidance: ['internal', 'change_combo'], suggestions: [], subjects: subjectsFromConflicts(conflicts) };
  }
  if (status === 'invalid') {
    return { category: 'invalid_combo', osErrorCode: null, owner: null, guidance: ['invalid', 'change_combo'], suggestions: [], subjects: [] };
  }
  if (status === 'available') {
    return { category: 'available', osErrorCode: null, owner: null, guidance: [], suggestions: [], subjects: [] };
  }
  if (status === 'not_checked') {
    return {
      category: 'not_checked',
      osErrorCode: null,
      owner: null,
      guidance: isBareF12(accelerator) ? ['not_checked', 'reserved_f12'] : ['not_checked'],
      suggestions: [],
      subjects: [],
    };
  }
  if (status === 'probe_error' || status === 'os_unavailable') {
    const splitAccelerator = accelerator || acceleratorFromRaw(raw);
    const detail = status === 'os_unavailable' && raw.includes('：') ? splitStoredNativeError(raw).detail : raw;
    const classed = classifyRegistrationFailure(detail, splitAccelerator, status === 'probe_error');
    return { ...classed, owner: null, subjects: [] };
  }
  return { category: 'unknown_system_failure', osErrorCode: explicitOsError(raw), owner: null, guidance: ['unknown_failure', 'owner_unknown', 'recheck', 'change_combo'], suggestions: [], subjects: [] };
}

function subjectsFromDiagnosis(value: unknown): InternalSubject[] {
  if (!Array.isArray(value)) return [];
  const subjects: InternalSubject[] = [];
  for (const item of value) {
    if (item == null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const moduleId = typeof row.module_id === 'string' ? row.module_id : '';
    const actionId = typeof row.action_id === 'string' ? row.action_id : '';
    if (!moduleId || !actionId) continue;
    const kind = row.kind === 'script' || moduleId === 'script_runner' || actionId.startsWith('script:') ? 'script' : 'module_action';
    subjects.push({
      module_id: moduleId,
      action_id: actionId,
      description: typeof row.description === 'string' ? row.description : '',
      enabled: row.enabled === true,
      kind,
    });
  }
  return subjects;
}

function subjectLine(subject: InternalSubject, moduleLabel: (moduleId: string) => string, actionLabel: (spec: ShortcutSpecRef) => string, disabledLabel: string): string {
  const moduleName = moduleLabel(subject.module_id);
  const disabled = !subject.enabled && disabledLabel ? ` (${disabledLabel})` : '';
  if (subject.kind === 'script') {
    const script = subject.description.trim() || subject.action_id;
    return `${moduleName} · ${script} (${subject.action_id})${disabled}`;
  }
  const action = actionLabel(subject);
  return `${moduleName} · ${action} (${subject.action_id})${disabled}`;
}

function stringCodes(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && allowed.has(item));
}

function indicatesAlreadyRegistered(detail: string): boolean {
  const lower = detail.toLowerCase();
  return lower.includes('hotkey already registered')
    || lower.includes('hot key already registered')
    || lower.includes('hot key is already registered')
    || lower.includes('error_hotkey_already_registered');
}

function isBareF12(accelerator: string): boolean {
  return accelerator.trim().toLowerCase() === 'f12';
}

function usesWindowsKey(accelerator: string): boolean {
  return accelerator.split('+').some(token => ['super', 'win', 'meta'].includes(token.trim().toLowerCase()));
}

function acceleratorFromRaw(raw: string): string {
  return raw.includes('：') ? splitStoredNativeError(raw).accelerator : '';
}

function firstText(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function emptyPresentation(actionLabel: string, actionId: string): ShortcutPresentation {
  return {
    visible: false,
    blocked: false,
    available: false,
    summaryKey: 'desktop.diagnosis.summary.unassigned',
    summaryParams: { combo: '', action: actionLabel, names: '', code: '' },
    category: 'unassigned',
    categoryKnown: true,
    categoryKey: 'desktop.diagnosis.categories.unassigned',
    combo: '',
    actionLabel,
    actionId,
    osErrorCode: null,
    owner: null,
    ownerRow: 'hidden',
    raw: '',
    guidanceKeys: [],
    suggestionKeys: [],
    subjectLines: [],
    showDetails: false,
  };
}
