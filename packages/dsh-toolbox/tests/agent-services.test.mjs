import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/agent/index.js'

const DESCRIPTOR = {
  artifact_id: 'artifact-1',
  mime_type: 'image/png',
  byte_length: 68,
  width: 1,
  height: 1,
}
const IMAGE_REF = {
  attachmentId: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  mediaType: 'image/png',
  bytes: 68,
  width: 1,
  height: 1,
}

function createTools() {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      if (definitions.has(definition.name)) throw new Error(`duplicate ${definition.name}`)
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  }
}

function createDesktop() {
  const listeners = new Set()
  return {
    snapshot: {
      revision: 1,
      modules: ['screenshot', 'screen_ink'].map(id => ({
        id,
        agent_supported: true,
        agent_allowed: true,
        agent_effective: true,
      })),
      methods: ['agent.screenshot.monitors', 'agent.screenshot.capture', 'agent.ink.snapshot'],
    },
    async getAgentAccess() {
      return this.snapshot
    },
    async agentCall() {
      return DESCRIPTOR
    },
    onAgentAccessChanged(listener) {
      listeners.add(listener)
      listener(this.snapshot)
      return () => listeners.delete(listener)
    },
  }
}

function createServiceHost(tools) {
  const services = new Map()
  const entries = []

  const scopeFor = entry => ({
    tools,
    toolboxDesktop: services.get('toolboxDesktop'),
    get(name) {
      return services.get(name)
    },
    effect(factory) {
      const dispose = factory()
      entry.disposers.push(dispose)
      return dispose
    },
    inject(names, callback) {
      return inject(names, callback)
    },
  })

  const tryStart = entry => {
    if (entry.active) return
    if (!entry.names.every(name => services.has(name))) return
    entry.active = true
    entry.callback(scopeFor(entry))
  }

  const disposeEntry = entry => {
    if (!entry.active) return
    entry.active = false
    for (const dispose of entry.disposers.splice(0)) {
      if (typeof dispose === 'function') dispose()
    }
    entry.started = false
  }

  const inject = (names, callback) => {
    const entry = { names, callback, active: false, disposers: [] }
    entries.push(entry)
    tryStart(entry)
    return () => disposeEntry(entry)
  }

  return {
    get: name => services.get(name),
    inject,
    add(name, value) {
      services.set(name, value)
      for (const entry of entries) {
        if (entry.active && entry.names.includes(name)) disposeEntry(entry)
      }
      for (const entry of entries) tryStart(entry)
    },
    remove(name) {
      services.delete(name)
      for (const entry of entries) {
        if (entry.names.includes(name)) disposeEntry(entry)
      }
    },
  }
}

function freshSignal() {
  return new AbortController().signal
}

test('image actions register when attachments and toolboxArtifacts arrive and withdraw on removal', async () => {
  const tools = createTools()
  const host = createServiceHost(tools)
  const desktop = createDesktop()
  const attachments = { async saveImage() { return IMAGE_REF } }
  const artifacts = { async read() { return new Uint8Array(68) } }

  apply(host)
  host.add('toolboxDesktop', desktop)
  await new Promise(resolve => setImmediate(resolve))

  const screenshot = () => tools.definitions.get('toolbox_screenshot')
  assert.ok(screenshot())
  assert.deepEqual(screenshot().parameters.properties.action.enum, ['monitors'])

  host.add('attachments', attachments)
  host.add('toolboxArtifacts', artifacts)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(screenshot().parameters.properties.action.enum, ['monitors', 'capture'])
  assert.deepEqual(
    tools.definitions.get('toolbox_screen_ink').parameters.properties.action.enum,
    ['snapshot'],
  )

  host.remove('toolboxArtifacts')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(screenshot().parameters.properties.action.enum, ['monitors'])
  assert.equal(tools.definitions.has('toolbox_screen_ink'), false)

  host.add('toolboxArtifacts', artifacts)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(screenshot().parameters.properties.action.enum, ['monitors', 'capture'])

  host.remove('toolboxDesktop')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(tools.definitions.size, 0)
})
