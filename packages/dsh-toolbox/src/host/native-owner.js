import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, mkdtemp, realpath, chmod, unlink, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectBridge } from '../bridge/client.js';
import { runtimeTarget } from './runtime-target.js';

export function hostError(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function within(promise, timeoutMs, code = 'NATIVE_STOP_TIMEOUT') {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(hostError(code, 'Native lifecycle operation exceeded its deadline')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export const HEADLESS_RUNTIME = Object.freeze({
  executable: 'win32-x64/dsh-toolbox-native.exe',
  manifest: 'native-manifest.json',
  flags: Object.freeze([]),
  shutdownMethod: 'bridge.shutdown',
  allowFileRoots: true,
  strictShutdown: false,
});

export class NativeOwner {
  constructor(subprocess, config, runtime = HEADLESS_RUNTIME) {
    this.subprocess = subprocess;
    this.config = config;
    this.runtime = runtime;
    this.instanceId = randomUUID();
    this.pipePath = `\\\\.\\pipe\\dsh-toolbox-${this.instanceId}`;
    this.startup = new AbortController();
    this.work = new AbortController();
    this.pending = new Set();
    this.unavailable = new Set();
    this.ready = false;
    this.stopping = false;
  }

  onUnavailable(listener) {
    this.unavailable.add(listener);
    return () => this.unavailable.delete(listener);
  }

  start() {
    this.startTask ??= this.startNative();
    return this.startTask;
  }

  async startNative() {
    const { config } = this;
    const target = runtimeTarget(this.runtime);
    if (!isAbsolute(config.dataDir)) throw hostError('INVALID_CONFIG', 'dataDir must be an absolute path');
    let executable = config.nativeExecutable;
    let manifestPath = config.nativeManifest;
    if (!executable) {
      executable = fileURLToPath(new URL(`../../resources/${target.executable}`, import.meta.url));
      manifestPath = new URL(`../../resources/${target.manifest}`, import.meta.url);
    }
    if (manifestPath) {
      if (typeof manifestPath === 'string' && !isAbsolute(manifestPath)) throw hostError('INVALID_CONFIG', 'Native manifest must be absolute');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const hash = createHash('sha256').update(await readFile(executable)).digest('hex');
      if (manifest.protocolVersion !== 1 || manifest.platform !== target.platform || manifest.architecture !== target.architecture || manifest.sha256 !== hash || (this.runtime.manifestTag && manifest.runtime !== this.runtime.manifestTag)) throw hostError('NATIVE_INTEGRITY', 'Bundled native binary does not match its release manifest');
    }
    if (!isAbsolute(executable)) throw hostError('INVALID_CONFIG', 'nativeExecutable must be an absolute path');
    await mkdir(config.dataDir, { recursive: true });
    if (process.platform === 'darwin') {
      // Keep sockaddr_un below its 104-byte limit even when dataDir is long.
      // The owner creates a fresh private directory; native verifies peer PID/uid.
      const base = await realpath(tmpdir());
      if (Buffer.byteLength(join(base, 'dsh-XXXXXX', 's')) > 103) throw hostError('INVALID_CONFIG', 'TMPDIR is too long for a private macOS socket');
      this.endpointDir = await mkdtemp(join(base, 'dsh-'));
      await chmod(this.endpointDir, 0o700);
      this.pipePath = join(this.endpointDir, 's');
    }
    this.startup.signal.throwIfAborted();
    executable = await this.subprocess.resolveExecutable(executable, undefined, this.startup.signal);
    const argv = [executable, ...this.runtime.flags, '--pipe-name', this.pipePath, '--instance-id', this.instanceId, '--data-dir', config.dataDir, '--parent-pid', String(process.pid)];
    if (this.runtime.allowFileRoots) {
      for (const root of config.readRoots) argv.push('--allow-read-root', root);
      for (const root of config.writeRoots) argv.push('--allow-write-root', root);
    }
    this.handle = this.subprocess.spawn({
      argv,
      cwd: config.dataDir,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } },
      graceMs: config.shutdownTimeoutMs,
      env: { TEMP: config.tempDir, TMP: config.tempDir, TMPDIR: config.tempDir },
    });
    this.outcome = this.handle.done.then(exit => ({ exit }), error => ({ error }));
    let exited = false;
    this.outcome.then(() => {
      exited = true;
      this.exited = true;
      if (this.ready && !this.stopping) {
        this.ready = false;
        for (const listener of this.unavailable) listener();
      }
    });
    const deadline = Date.now() + config.startupTimeoutMs;
    while (Date.now() < deadline) {
      this.startup.signal.throwIfAborted();
      if (exited) throw hostError('NATIVE_START_FAILED', 'The desktop exited before readiness; verify toolbox-plugin protocol support and isolated data configuration');
      try {
        this.bridge = await connectBridge({ pipePath: this.pipePath, instanceId: this.instanceId, signal: this.startup.signal, timeoutMs: Math.max(1, Math.min(500, deadline - Date.now())), cancelTimeoutMs: config.cancelTimeoutMs });
        if (exited || this.bridge.isClosed) throw hostError('NATIVE_START_FAILED', 'The native process exited during startup');
        this.ready = true;
        return this;
      } catch (error) {
        if (this.startup.signal.aborted) throw error;
        if (!['DISCONNECTED', 'TIMEOUT'].includes(error.code)) throw error;
        await sleep(25, undefined, { signal: this.startup.signal });
      }
    }
    throw hostError('NATIVE_START_TIMEOUT', 'The native toolbox did not become ready within startupTimeoutMs');
  }

  get capabilities() { return this.ready && this.bridge && !this.bridge.isClosed ? this.bridge.capabilities : []; }

  request(method, params, { signal, timeoutMs = this.config.requestTimeoutMs } = {}) {
    if (this.stopping || !this.ready || this.bridge?.isClosed) return Promise.reject(hostError('NATIVE_UNAVAILABLE', 'The native toolbox is unavailable'));
    const requestSignal = signal ? AbortSignal.any([signal, this.work.signal]) : this.work.signal;
    const pending = this.bridge.request(method, params, { signal: requestSignal, timeoutMs });
    this.pending.add(pending);
    pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending));
    return pending;
  }

  close() {
    this.closeTask ??= this.stopNative();
    return this.closeTask;
  }

  async stopNative() {
    this.stopping = true;
    this.ready = false;
    this.startup.abort();
    this.work.abort();
    if (this.startTask) await this.startTask.catch(() => {});
    let mustTerminate = false;
    let shutdownProblem;
    try { await within(Promise.allSettled([...this.pending]), this.config.cancelTimeoutMs + 500); }
    catch (error) { mustTerminate = true; shutdownProblem = error; }
    if (this.bridge && !this.bridge.isClosed && !mustTerminate) {
      try { await within(this.bridge.request(this.runtime.shutdownMethod, {}, { timeoutMs: this.config.shutdownTimeoutMs }), this.config.shutdownTimeoutMs + this.config.cancelTimeoutMs); }
      catch (error) { mustTerminate = true; shutdownProblem = error; }
    }
    try {
      if (this.handle) {
        if (!mustTerminate) {
          try { await within(this.handle.waitForExit(), this.config.shutdownTimeoutMs); }
          catch (error) { mustTerminate = true; shutdownProblem = error; }
        }
        if (mustTerminate) {
          await within(Promise.resolve(this.handle.terminate()), this.config.shutdownTimeoutMs);
          await within(this.handle.waitForExit(), this.config.shutdownTimeoutMs);
        }
      }
    } finally {
      try { if (this.bridge) await within(this.bridge.close(), this.config.shutdownTimeoutMs); }
      finally {
        this.unavailable.clear();
        if (this.endpointDir && (!this.handle || this.exited)) {
          await unlink(this.pipePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
          await rmdir(this.endpointDir).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      }
    }
    if (this.runtime.strictShutdown && shutdownProblem) {
      const error = hostError('DESKTOP_SHUTDOWN_FAILED', 'The desktop runtime required forced termination; pending edits were not confirmed saved');
      error.cause = shutdownProblem;
      throw error;
    }
  }
}
