import { agentError, jsonSafe, throwIfAborted } from './common.js'
import { MODULE_SPECS } from './specs.js'
import { createScreenshotTool } from './screenshot.js'
import { createClipboardTool } from './clipboard.js'
import { createScreenInkTool } from './screen-ink.js'
import { createUsageTool } from './app-usage.js'
import { createNotesTool } from './notes.js'
import { validateArtifactDescriptor } from './image.js'

const FACTORIES = Object.freeze({
  screenshot: createScreenshotTool,
  clipboard: createClipboardTool,
  screen_ink: createScreenInkTool,
  app_usage: createUsageTool,
  sticky_note: createNotesTool,
})

const DISCONNECT_CODES = new Set([
  'NATIVE_UNAVAILABLE',
  'UNAVAILABLE',
  'OUTCOME_UNKNOWN',
  'NATIVE_START_FAILED',
  'NATIVE_INTEGRITY',
  'DESKTOP_PROTOCOL',
  'DESKTOP_CAPABILITIES',
])

function normalizeSnapshot(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  if (!Array.isArray(raw.modules) || !Array.isArray(raw.methods)) return undefined
  const modules = new Map()
  for (const module of raw.modules) {
    if (module === null || typeof module !== 'object' || Array.isArray(module)) continue
    if (typeof module.id !== 'string' || module.id === '') continue
    modules.set(module.id, {
      id: module.id,
      agent_supported: module.agent_supported === true,
      agent_allowed: module.agent_allowed === true,
      agent_effective: module.agent_effective === true,
    })
  }
  const methods = new Set(raw.methods.filter(method => typeof method === 'string' && method !== ''))
  return { modules, methods }
}

function effectiveFor(snapshot, moduleId) {
  const access = snapshot.modules.get(moduleId)
  return access !== undefined
    && access.agent_supported
    && access.agent_allowed
    && access.agent_effective
}

function sameActions(left, right) {
  return left.length === right.length && left.every((action, index) => action === right[index])
}

function isCancellation(error) {
  return error?.name === 'AbortError' || error?.code === 'CANCELLED'
}

function committedImageResult(descriptor) {
  return jsonSafe({
    artifact: validateArtifactDescriptor(descriptor),
    image: null,
    publication: 'cancelled',
  })
}

export class AgentToolRegistry {
  constructor({ tools, desktop, imagePublisher }) {
    if (tools === null || typeof tools !== 'object' || typeof tools.register !== 'function') {
      throw new TypeError('AgentToolRegistry requires the tools service')
    }
    if (desktop === null || typeof desktop !== 'object' || typeof desktop.getAgentAccess !== 'function'
      || typeof desktop.agentCall !== 'function') {
      throw new TypeError('AgentToolRegistry requires toolboxDesktop.getAgentAccess/agentCall')
    }
    this.tools = tools
    this.desktop = desktop
    this.imagePublisher = imagePublisher
    this.registrations = new Map()
    this.registrationErrors = new Map()
    this.snapshot = undefined
    this.started = false
    this.disposed = false
    this.listenerOff = undefined
  }

  get imageCapable() {
    return this.imagePublisher !== undefined && typeof this.imagePublisher.publish === 'function'
  }

  async start(signal) {
    if (this.started || this.disposed) return
    this.started = true
    this.subscribe()
    try {
      const snapshot = await this.desktop.getAgentAccess({ signal })
      this.applySnapshot(snapshot)
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted === true) throw error
      this.withdrawAll()
    }
  }

  subscribe() {
    if (this.disposed || this.listenerOff !== undefined
      || typeof this.desktop.onAgentAccessChanged !== 'function') return
    try {
      const off = this.desktop.onAgentAccessChanged(snapshot => {
        if (!this.disposed) this.applySnapshot(snapshot)
      })
      if (typeof off === 'function') this.listenerOff = off
    } catch {
      // The initial getAgentAccess call still applies a snapshot; live execution
      // rechecks access on every call even without a subscription.
      this.listenerOff = undefined
    }
  }

  applySnapshot(raw) {
    if (this.disposed) return
    const snapshot = normalizeSnapshot(raw)
    if (snapshot === undefined) {
      this.snapshot = undefined
      this.withdrawAll()
      return
    }
    this.snapshot = snapshot
    this.reconcile(snapshot)
  }

  desiredActions(snapshot) {
    const desired = new Map()
    for (const spec of Object.values(MODULE_SPECS)) {
      if (!effectiveFor(snapshot, spec.id)) continue
      const actions = spec.actions
        .filter(action => snapshot.methods.has(action.method))
        .filter(action => !action.image || this.imageCapable)
        .map(action => action.id)
      if (actions.length > 0) desired.set(spec.id, actions)
    }
    return desired
  }

  reconcile(snapshot) {
    const desired = this.desiredActions(snapshot)
    for (const [moduleId, registration] of [...this.registrations]) {
      const actions = desired.get(moduleId)
      if (actions === undefined || !sameActions(registration.actions, actions)) {
        registration.dispose()
        this.registrations.delete(moduleId)
      }
    }
    for (const [moduleId, actions] of desired) {
      if (this.registrations.has(moduleId)) continue
      const spec = MODULE_SPECS[moduleId]
      try {
        const tool = FACTORIES[moduleId](actions, (targetModule, action, params, exec) => (
          this.runAction(targetModule, action, params, exec)
        ))
        const dispose = this.tools.register(tool)
        this.registrations.set(moduleId, {
          actions,
          dispose: typeof dispose === 'function' ? dispose : () => {},
        })
        this.registrationErrors.delete(moduleId)
      } catch (error) {
        this.registrationErrors.set(moduleId, error)
      }
    }
  }

  withdrawAll() {
    for (const registration of this.registrations.values()) registration.dispose()
    this.registrations.clear()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (typeof this.listenerOff === 'function') this.listenerOff()
    this.listenerOff = undefined
    this.withdrawAll()
  }

  setImagePublisher(publisher) {
    if (this.disposed) return
    this.imagePublisher = publisher
    if (this.snapshot !== undefined) this.reconcile(this.snapshot)
  }

  handleDisconnect(error) {
    if (DISCONNECT_CODES.has(error?.code)) this.withdrawAll()
  }

  async ensureAuthorized(moduleId, actionId, signal) {
    throwIfAborted(signal)
    let raw
    try {
      raw = await this.desktop.getAgentAccess({ signal })
    } catch (error) {
      this.handleDisconnect(error)
      throw error
    }
    const snapshot = normalizeSnapshot(raw)
    if (snapshot === undefined) {
      this.withdrawAll()
      throw agentError('UNAVAILABLE', 'agent access snapshot is unavailable')
    }
    this.applySnapshot(raw)
    throwIfAborted(signal)

    const access = snapshot.modules.get(moduleId)
    if (access === undefined || !access.agent_supported) {
      throw agentError('UNSUPPORTED', `${moduleId} does not support Agent access`)
    }
    if (!access.agent_allowed) {
      throw agentError('AGENT_ACCESS_DENIED', `${moduleId} Agent access is not granted`)
    }
    if (!access.agent_effective) {
      throw agentError('MODULE_DISABLED', `${moduleId} is not currently enabled`)
    }
    const spec = MODULE_SPECS[moduleId]
    const action = spec.actions.find(entry => entry.id === actionId)
    if (action === undefined || !snapshot.methods.has(action.method)) {
      throw agentError('UNSUPPORTED', `${moduleId}.${actionId} is not advertised by the native runtime`)
    }
    if (action.image && !this.imageCapable) {
      throw agentError('UNSUPPORTED', `${moduleId}.${actionId} requires the configured image publisher`)
    }
    return { snapshot, action }
  }

  async runAction(moduleId, actionId, params, exec) {
    throwIfAborted(exec.signal)
    try {
      const { action } = await this.ensureAuthorized(moduleId, actionId, exec.signal)
      const result = await this.desktop.agentCall(action.method, params, { signal: exec.signal })
      // A resolved native result is authoritative. Do not turn a committed
      // write into "not executed" just because cancellation arrived late.
      if (action.image) {
        if (exec.signal.aborted) return committedImageResult(result)
        try {
          return await this.imagePublisher.publish({
            moduleId,
            actionId,
            descriptor: result,
            signal: exec.signal,
            ensureAuthorized: signal => this.ensureAuthorized(moduleId, actionId, signal),
          })
        } catch (error) {
          if (isCancellation(error)) return committedImageResult(result)
          throw error
        }
      }
      return jsonSafe(result)
    } catch (error) {
      this.handleDisconnect(error)
      throw error
    }
  }
}

export function createAgentToolRegistry(options) {
  return new AgentToolRegistry(options)
}
