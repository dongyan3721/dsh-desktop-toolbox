import { Service } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { NativeOwner, hostError } from '../host/native-owner.js';
import { DesktopAgentAccess } from './agent-access.js';
import { ToolboxArtifactService } from './artifacts.js';
import { resolveDesktopDataDir } from './data-dir.js';
import { validateConsoleRequest } from '../human-entry/console.js';

export const DESKTOP_RUNTIME = Object.freeze({
  executable: 'win32-x64/all-in-one-desktop.exe',
  manifest: 'desktop-manifest.json',
  manifestTag: 'desktop',
  flags: Object.freeze(['--toolbox-plugin']),
  shutdownMethod: 'desktop.shutdown',
  allowFileRoots: false,
  strictShutdown: true,
});

export const name = 'toolbox-desktop-runtime';
export const inject = ['subprocess'];
export const Config = Schema.object({
  dataDir: Schema.string().default(''),
  nativeExecutable: Schema.string().default(''),
  startupTimeoutMs: Schema.number().default(20000),
  requestTimeoutMs: Schema.number().default(5000),
  cancelTimeoutMs: Schema.number().default(1500),
  shutdownTimeoutMs: Schema.number().default(10000),
});

const MODULES = new Set(['screenshot', 'clipboard', 'screen_ink', 'media_proc', 'sticky_note', 'window_pin', 'script_runner', 'app_usage', 'translator', 'password_vault']);
const REQUIRED_METHODS = ['status', 'desktop.show_main', 'desktop.open_panel', 'desktop.shutdown'];

function normalizeConfig(config) {
  const dataDir = resolveDesktopDataDir(config.dataDir);
  for (const field of ['startupTimeoutMs', 'requestTimeoutMs', 'cancelTimeoutMs', 'shutdownTimeoutMs']) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1 || config[field] > 2147483647) throw hostError('INVALID_CONFIG', `${field} must be a timer-safe positive integer`);
  }
  if (config.nativeExecutable && !isAbsolute(config.nativeExecutable)) throw hostError('INVALID_CONFIG', 'Desktop executable override must be absolute');
  return { ...config, dataDir, tempDir: join(dataDir, '.tmp'), readRoots: [], writeRoots: [] };
}

/** Human runtime service; deliberately has no tools/Agent dependency or registration. */
export class ToolboxDesktopService extends Service {
  constructor(ctx, config, ownerFactory) {
    super(ctx, 'toolboxDesktop');
    this.config = normalizeConfig(config);
    this.createOwner = ownerFactory ?? (() => new NativeOwner(ctx.subprocess, this.config, DESKTOP_RUNTIME));
    this.phase = 'starting';
    this.stopping = false;
    this.agentAccess = new DesktopAgentAccess(this);
    ctx.effect(() => async () => {
      this.stopping = true;
      this.phase = 'stopping';
      this.agentAccess.dispose();
      await this.launchTask?.catch(() => {});
      await this.owner?.close();
    });
  }

  start() {
    if (this.stopping) return Promise.reject(hostError('NATIVE_UNAVAILABLE', 'The desktop runtime is stopping'));
    if (this.owner?.ready && !this.owner.bridge?.isClosed) return Promise.resolve();
    this.launchTask ??= this.launch().catch(error => { this.phase = 'unavailable'; throw error; });
    return this.launchTask;
  }

  async launch() {
    const previous = this.owner;
    const wasExited = this.previousExited === true;
    this.previousExited = false;
    this.phase = 'starting';
    if (previous) {
      try { await previous.close(); }
      catch (error) { if (!wasExited) throw error; }
    }
    await mkdir(this.config.tempDir, { recursive: true });
    const owner = this.createOwner();
    this.owner = owner;
    owner.onUnavailable(() => {
      if (this.owner !== owner || this.stopping) return;
      this.phase = 'unavailable';
      this.agentAccess.invalidate();
      this.previousExited = true;
      // Only a later explicit user action starts a replacement. Never replay
      // the previous control request after an uncertain transport outcome.
      this.launchTask = undefined;
    });
    await owner.start();
    if (!REQUIRED_METHODS.every(method => this.owner.capabilities.includes(method))) throw hostError('DESKTOP_CAPABILITIES', 'The executable does not provide the required desktop control methods');
    await this.readStatus();
    this.phase = 'ready';
  }

  async readStatus(signal) {
    const status = await this.owner.request('status', {}, { signal });
    if (status?.desktop !== true || status.protocolVersion !== 1 || typeof status.nativeVersion !== 'string' || status.nativeVersion.length === 0) throw hostError('DESKTOP_PROTOCOL', 'The native runtime did not confirm desktop mode');
    return { phase: 'ready', nativeConnected: true, nativeVersion: status.nativeVersion, capabilities: [...this.owner.capabilities] };
  }

  async status(signal) {
    signal?.throwIfAborted();
    if (this.phase !== 'ready' || !this.owner?.ready || this.owner.bridge?.isClosed) return { phase: this.stopping ? 'stopping' : this.phase === 'starting' ? 'starting' : 'unavailable', nativeConnected: false, nativeVersion: '', capabilities: [] };
    return this.readStatus(signal);
  }

  async ensureReady(signal) {
    signal?.throwIfAborted();
    await this.start();
    signal?.throwIfAborted();
    if (!this.owner?.ready || this.owner.bridge?.isClosed) throw hostError('NATIVE_UNAVAILABLE', 'The desktop runtime is unavailable; reload the plugin');
  }

  async showMain({ signal } = {}) {
    await this.ensureReady(signal);
    const result = await this.owner.request('desktop.show_main', {}, { signal });
    if (result?.opened !== true) throw hostError('DESKTOP_PROTOCOL', 'The runtime did not acknowledge opening its main window');
    return { opened: true };
  }

  async openPanel(moduleId, { signal } = {}) {
    if (!MODULES.has(moduleId)) throw hostError('INVALID_REQUEST', 'Unknown toolbox panel');
    await this.ensureReady(signal);
    const result = await this.owner.request('desktop.open_panel', { module_id: moduleId }, { signal });
    if (result?.opened !== true) throw hostError('DESKTOP_PROTOCOL', 'The runtime did not acknowledge opening its panel');
    return { opened: true };
  }

  getAgentAccess(options) { return this.agentAccess.get(options); }
  async console(payload, { signal } = {}) {
    const request = validateConsoleRequest(payload);
    if (['snapshot', 'getShortcutPreferences', 'checkShortcut', 'checkAllShortcuts'].includes(request.action)) {
      signal?.throwIfAborted();
      if (this.phase === 'starting') await this.launchTask;
      if (this.phase !== 'ready' || !this.owner?.ready || this.owner.bridge?.isClosed) throw hostError('NATIVE_UNAVAILABLE', 'The toolbox has stopped. Reconnect the console to start it again.');
    } else await this.ensureReady(signal);
    if (!this.owner.capabilities.includes('desktop.console')) throw hostError('UNSUPPORTED', 'Update the desktop executable to use the embedded console');
    return this.owner.request('desktop.console', request.action === 'reconnect' ? { action: 'snapshot', args: {} } : request, { signal });
  }
  agentCall(method, params, options) { return this.agentAccess.call(method, params, options); }
  onAgentAccessChanged(listener) { return this.agentAccess.onChanged(listener); }
}

export async function apply(ctx, config) {
  const service = new ToolboxDesktopService(ctx, config);
  await service.start();
  new ToolboxArtifactService(ctx, service);
}
