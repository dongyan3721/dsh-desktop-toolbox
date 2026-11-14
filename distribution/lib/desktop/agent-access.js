import { hostError } from '../host/native-owner.js';

export const AGENT_METHOD_MODULE = Object.freeze({
  'agent.screenshot.monitors': 'screenshot',
  'agent.screenshot.capture': 'screenshot',
  'agent.clipboard.list': 'clipboard',
  'agent.clipboard.read_text': 'clipboard',
  'agent.clipboard.write_text': 'clipboard',
  'agent.ink.status': 'screen_ink',
  'agent.ink.start': 'screen_ink',
  'agent.ink.stop': 'screen_ink',
  'agent.ink.passthrough': 'screen_ink',
  'agent.ink.clear': 'screen_ink',
  'agent.ink.draw': 'screen_ink',
  'agent.ink.snapshot': 'screen_ink',
  'agent.usage.status': 'app_usage',
  'agent.usage.overview': 'app_usage',
  'agent.usage.apps': 'app_usage',
  'agent.usage.hourly': 'app_usage',
  'agent.notes.search': 'sticky_note',
  'agent.notes.read': 'sticky_note',
  'agent.notes.create': 'sticky_note',
  'agent.notes.update': 'sticky_note',
  'agent.notes.open': 'sticky_note',
});
const SUPPORTED = new Set(Object.values(AGENT_METHOD_MODULE));
const DISCONNECTED = new Set(['NATIVE_UNAVAILABLE', 'UNAVAILABLE', 'OUTCOME_UNKNOWN', 'CLOSED', 'DISCONNECTED', 'TIMEOUT', 'PROTOCOL_ERROR', 'DESKTOP_PROTOCOL', 'NATIVE_INTEGRITY']);

const emptySnapshot = () => ({ revision: 0, modules: [], methods: [] });

/** Drop all business/config fields at this boundary: subscribers get metadata only. */
export function normalizeAgentAccess(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.modules) || value.modules.length > 32
    || !Array.isArray(value.methods) || value.methods.length > 64) {
    throw hostError('DESKTOP_PROTOCOL', 'Invalid Agent access metadata');
  }
  const ids = new Set();
  const modules = value.modules.map(entry => {
    if (!entry || typeof entry.id !== 'string' || entry.id.length > 80 || ids.has(entry.id)
      || ['agent_supported', 'agent_allowed', 'agent_effective'].some(key => typeof entry[key] !== 'boolean')) {
      throw hostError('DESKTOP_PROTOCOL', 'Invalid Agent module metadata');
    }
    ids.add(entry.id);
    const supported = SUPPORTED.has(entry.id) && entry.agent_supported;
    const allowed = supported && entry.agent_allowed;
    return { id: entry.id, agent_supported: supported, agent_allowed: allowed, agent_effective: allowed && entry.agent_effective };
  });
  if (value.methods.some(method => typeof method !== 'string' || method.length > 80)) {
    throw hostError('DESKTOP_PROTOCOL', 'Invalid Agent method metadata');
  }
  return { revision: value.revision, modules, methods: [...new Set(value.methods.filter(method => Object.hasOwn(AGENT_METHOD_MODULE, method)))] };
}

/** Agent requests never invoke desktop.start(), and never create/replay a process. */
export class DesktopAgentAccess {
  constructor(desktop, { pollIntervalMs = 1000 } = {}) {
    this.desktop = desktop;
    this.pollIntervalMs = pollIntervalMs;
    this.listeners = new Set();
    this.snapshot = emptySnapshot();
    this.snapshotKey = '';
    this.epoch = 0;
    this.disposed = false;
  }

  requireOwner() {
    const { owner, phase, stopping } = this.desktop;
    if (this.disposed || stopping || phase !== 'ready' || !owner?.ready || owner.bridge?.isClosed) {
      throw hostError('NATIVE_UNAVAILABLE', 'Desktop is unavailable; open or reload the toolbox');
    }
    return owner;
  }

  publish(snapshot) {
    const key = JSON.stringify(snapshot);
    if (key === this.snapshotKey) return;
    this.snapshot = snapshot;
    this.snapshotKey = key;
    for (const listener of this.listeners) {
      try { listener(structuredClone(snapshot)); } catch { /* One observer cannot stop revocation. */ }
    }
  }

  invalidate() {
    this.epoch++;
    this.pollController?.abort();
    this.publish(emptySnapshot());
  }

  async get({ signal } = {}) {
    signal?.throwIfAborted();
    const owner = this.requireOwner();
    if (!owner.capabilities.includes('agent.get_access')) {
      this.publish(emptySnapshot());
      throw hostError('UNSUPPORTED', 'This desktop version does not provide Agent access');
    }
    const epoch = this.epoch;
    const sequence = this.nextRead = (this.nextRead ?? 0) + 1;
    try {
      const raw = await owner.request('agent.get_access', {}, { signal });
      signal?.throwIfAborted();
      if (owner !== this.requireOwner() || epoch !== this.epoch) throw hostError('NATIVE_UNAVAILABLE', 'Desktop instance changed');
      const snapshot = normalizeAgentAccess(raw);
      // Out-of-order reads cannot republish stale grants to subscribers.
      if (sequence >= (this.lastPublishedRead ?? 0)) {
        this.lastPublishedRead = sequence;
        this.publish(snapshot);
      }
      return snapshot;
    } catch (error) {
      if (DISCONNECTED.has(error?.code)) this.invalidate();
      throw error;
    }
  }

  onChanged(listener) {
    if (typeof listener !== 'function') throw new TypeError('Agent access listener must be a function');
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    // Initial delivery is fail-closed; polling delivers the first native snapshot.
    try { listener(structuredClone(this.snapshot)); } catch {}
    this.schedulePoll(0);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.pollController?.abort();
      }
    };
  }

  schedulePoll(delay = this.pollIntervalMs) {
    if (this.disposed || this.listeners.size === 0 || this.pollTimer || this.polling) return;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = undefined;
      this.polling = true;
      const controller = this.pollController = new AbortController();
      try { await this.get({ signal: controller.signal }); }
      catch { if (!controller.signal.aborted) this.publish(emptySnapshot()); }
      finally {
        if (this.pollController === controller) this.pollController = undefined;
        this.polling = false;
        this.schedulePoll();
      }
    }, delay);
    this.pollTimer.unref?.();
  }

  async call(method, params = {}, { signal } = {}) {
    signal?.throwIfAborted();
    const artifact = method === 'agent.artifacts.read';
    const moduleId = artifact ? params?.module_id : AGENT_METHOD_MODULE[method];
    if (!moduleId || (artifact && !['screenshot', 'screen_ink'].includes(moduleId))) {
      throw hostError('UNSUPPORTED', 'This method is not an allowed Agent operation');
    }
    const owner = this.requireOwner();
    const snapshot = await this.get({ signal });
    if (owner !== this.requireOwner()) throw hostError('NATIVE_UNAVAILABLE', 'Desktop instance changed');
    const access = snapshot.modules.find(module => module.id === moduleId);
    if (!access?.agent_supported) throw hostError('UNSUPPORTED', 'Module does not support Agent access');
    if (!access.agent_allowed) throw hostError('AGENT_ACCESS_DENIED', 'Agent access is not granted');
    if (!access.agent_effective) throw hostError('MODULE_DISABLED', 'Module is not currently available and enabled');
    if (artifact ? !owner.capabilities.includes(method) : !snapshot.methods.includes(method)) {
      throw hostError('UNSUPPORTED', 'Method is not implemented by this desktop');
    }
    signal?.throwIfAborted();
    try {
      // Native performs the authoritative current-grant check and side effect.
      // Its committed response remains authoritative even on late cancellation.
      return await owner.request(method, params, { signal, timeoutMs: 20000 });
    } catch (error) {
      if (DISCONNECTED.has(error?.code)) this.invalidate();
      throw error;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.invalidate();
    this.listeners.clear();
  }
}
