import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, createAgentToolsForContext } from '../src/agent/index.js'
import { createAgentToolRegistry } from '../src/agent/registry.js'

const ALL_METHODS = [
  'agent.screenshot.monitors',
  'agent.screenshot.capture',
  'agent.clipboard.list',
  'agent.clipboard.read_text',
  'agent.clipboard.write_text',
  'agent.ink.status',
  'agent.ink.start',
  'agent.ink.stop',
  'agent.ink.passthrough',
  'agent.ink.clear',
  'agent.ink.draw',
  'agent.ink.snapshot',
  'agent.usage.status',
  'agent.usage.overview',
  'agent.usage.apps',
  'agent.usage.hourly',
  'agent.notes.search',
  'agent.notes.read',
  'agent.notes.create',
  'agent.notes.update',
  'agent.notes.open',
]

function createTools() {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      if (definitions.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
      definitions.set(definition.name, definition)
      return () => {
        if (definitions.get(definition.name) === definition) definitions.delete(definition.name)
      }
    },
    names() {
      return [...definitions.keys()].sort()
    },
  }
}

function access(id, overrides = {}) {
  return {
    id,
    agent_supported: true,
    agent_allowed: true,
    agent_effective: true,
    ...overrides,
  }
}

function snapshot({ modules = [], methods = ALL_METHODS, revision = 1 } = {}) {
  return { revision, modules, methods: [...methods] }
}

function createDesktop(initialSnapshot, callHandler = () => ({ ok: true })) {
  const listeners = new Set()
  const desktop = {
    snapshot: initialSnapshot,
    accessCalls: 0,
    calls: [],
    nextAccessError: undefined,
    async getAgentAccess(options = {}) {
      this.accessCalls += 1
      if (this.nextAccessError !== undefined) {
        const error = this.nextAccessError
        this.nextAccessError = undefined
        throw error
      }
      options.signal?.throwIfAborted?.()
      return this.snapshot
    },
    async agentCall(method, params, options = {}) {
      this.calls.push({ method, params, options })
      options.signal?.throwIfAborted?.()
      return callHandler(method, params, options, this)
    },
    onAgentAccessChanged(listener) {
      listeners.add(listener)
      listener(this.snapshot)
      return () => listeners.delete(listener)
    },
    emit(next) {
      this.snapshot = next
      for (const listener of listeners) listener(next)
    },
    listenerCount() {
      return listeners.size
    },
  }
  return desktop
}

function freshSignal() {
  return new AbortController().signal
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve))
}

test('default no authorization and malformed snapshots register no tools', async () => {
  for (const initial of [
    snapshot({ modules: [access('screenshot', { agent_allowed: false, agent_effective: false })] }),
    snapshot({ modules: [access('sticky_note', { agent_allowed: false, agent_effective: false })] }),
    snapshot({ modules: [access('screenshot', { agent_supported: false })] }),
    snapshot({ modules: [access('media_proc')] }),
    snapshot({ modules: [access('screenshot')], methods: [] }),
    null,
  ]) {
    const tools = createTools()
    const registry = createAgentToolRegistry({ tools, desktop: createDesktop(initial) })
    await registry.start(freshSignal())
    assert.deepEqual(tools.names(), [])
    registry.dispose()
  }
})

test('only advertised methods for effective supported modules are registered', async () => {
  const tools = createTools()
  const initial = snapshot({
    modules: [
      access('screenshot'),
      access('clipboard'),
      access('screen_ink'),
      access('app_usage'),
      access('sticky_note'),
    ],
    methods: [
      'agent.screenshot.monitors',
      'agent.clipboard.list',
      'agent.ink.status',
      'agent.ink.draw',
      'agent.usage.status',
      'agent.usage.hourly',
      'agent.notes.search',
      'agent.notes.read',
      'agent.notes.create',
      'agent.notes.update',
      'agent.notes.open',
      'agent.media.convert_image',
    ],
  })
  const registry = createAgentToolRegistry({ tools, desktop: createDesktop(initial) })
  await registry.start(freshSignal())

  assert.deepEqual(tools.names(), [
    'toolbox_clipboard',
    'toolbox_notes',
    'toolbox_screen_ink',
    'toolbox_screenshot',
    'toolbox_usage',
  ])
  assert.deepEqual(tools.definitions.get('toolbox_screenshot').parameters.properties.action.enum, ['monitors'])
  assert.deepEqual(tools.definitions.get('toolbox_clipboard').parameters.properties.action.enum, ['list'])
  assert.deepEqual(tools.definitions.get('toolbox_screen_ink').parameters.properties.action.enum, ['status', 'draw'])
  assert.deepEqual(tools.definitions.get('toolbox_usage').parameters.properties.action.enum, ['status', 'hourly'])
  assert.deepEqual(tools.definitions.get('toolbox_notes').parameters.properties.action.enum, [
    'search', 'read', 'create', 'update', 'open',
  ])
  registry.dispose()
})

test('grant, module enablement, and method advertisement reconcile independently', async () => {
  const tools = createTools()
  const desktop = createDesktop(snapshot({
    modules: [access('screenshot', { agent_allowed: false, agent_effective: false })],
    methods: ['agent.screenshot.monitors'],
  }))
  const registry = createAgentToolRegistry({ tools, desktop })
  await registry.start(freshSignal())
  assert.deepEqual(tools.names(), [])

  desktop.emit(snapshot({
    modules: [access('screenshot', { agent_effective: false })],
    methods: ['agent.screenshot.monitors'],
  }))
  assert.deepEqual(tools.names(), [], 'grant without enabled module must stay ineffective')

  desktop.emit(snapshot({
    modules: [access('screenshot')],
    methods: ['agent.screenshot.monitors'],
  }))
  assert.deepEqual(tools.names(), ['toolbox_screenshot'])

  desktop.emit(snapshot({
    modules: [access('screenshot', { agent_allowed: false, agent_effective: false })],
    methods: ['agent.screenshot.monitors'],
  }))
  assert.deepEqual(tools.names(), [])

  desktop.emit(snapshot({
    modules: [access('clipboard')],
    methods: ['agent.clipboard.list'],
  }))
  assert.deepEqual(tools.names(), ['toolbox_clipboard'])
  registry.dispose()
})

test('unsupported modules are never exposed even with forged effective access', async () => {
  const tools = createTools()
  const initial = snapshot({
    modules: [
      access('media_proc'),
      access('translator'),
      access('window_pin'),
      access('script_runner'),
      access('password_vault'),
      access('screenshot'),
      access('sticky_note'),
    ],
    methods: ALL_METHODS,
  })
  const registry = createAgentToolRegistry({ tools, desktop: createDesktop(initial) })
  await registry.start(freshSignal())
  assert.deepEqual(tools.names(), ['toolbox_notes', 'toolbox_screenshot'])
  registry.dispose()
})

test('an old tool reference rechecks live grant and never calls the service after revoke', async () => {
  const tools = createTools()
  const desktop = createDesktop(snapshot({
    modules: [access('screenshot')],
    methods: ['agent.screenshot.monitors'],
  }))
  const registry = createAgentToolRegistry({ tools, desktop })
  await registry.start(freshSignal())
  const oldTool = tools.definitions.get('toolbox_screenshot')
  assert.ok(oldTool)

  desktop.emit(snapshot({
    modules: [access('screenshot', { agent_allowed: false, agent_effective: false })],
    methods: ['agent.screenshot.monitors'],
  }))
  assert.equal(tools.definitions.has('toolbox_screenshot'), false)

  await assert.rejects(
    oldTool.execute({ action: 'monitors' }, { signal: freshSignal() }),
    error => error.code === 'AGENT_ACCESS_DENIED',
  )
  assert.equal(desktop.calls.length, 0)

  desktop.emit(snapshot({
    modules: [access('screenshot', { agent_effective: false })],
    methods: ['agent.screenshot.monitors'],
  }))
  await assert.rejects(
    oldTool.execute({ action: 'monitors' }, { signal: freshSignal() }),
    error => error.code === 'MODULE_DISABLED',
  )
  assert.equal(desktop.calls.length, 0)

  desktop.emit(snapshot({
    modules: [access('screenshot')],
    methods: [],
  }))
  await assert.rejects(
    oldTool.execute({ action: 'monitors' }, { signal: freshSignal() }),
    error => error.code === 'UNSUPPORTED',
  )
  assert.equal(desktop.calls.length, 0)
})

test('all five modules revoke independently and re-register on a fresh grant', async () => {
  const cases = [
    ['screenshot', 'toolbox_screenshot', 'agent.screenshot.monitors', { action: 'monitors' }],
    ['clipboard', 'toolbox_clipboard', 'agent.clipboard.list', { action: 'list' }],
    ['screen_ink', 'toolbox_screen_ink', 'agent.ink.status', { action: 'status' }],
    ['app_usage', 'toolbox_usage', 'agent.usage.status', { action: 'status' }],
    ['sticky_note', 'toolbox_notes', 'agent.notes.search', { action: 'search' }],
  ]

  for (const [moduleId, toolName, method, args] of cases) {
    const tools = createTools()
    const desktop = createDesktop(snapshot({
      modules: [access(moduleId)],
      methods: [method],
    }))
    const registry = createAgentToolRegistry({ tools, desktop })
    await registry.start(freshSignal())

    assert.deepEqual(tools.names(), [toolName], `${moduleId} should register its own tool`)
    const oldTool = tools.definitions.get(toolName)
    assert.ok(oldTool)

    desktop.emit(snapshot({
      modules: [access(moduleId, { agent_allowed: false, agent_effective: false })],
      methods: [method],
    }))
    assert.equal(tools.definitions.has(toolName), false, `${moduleId} tool must be withdrawn`)
    await assert.rejects(
      oldTool.execute(args, { signal: freshSignal() }),
      error => error.code === 'AGENT_ACCESS_DENIED',
      `${moduleId} old tool reference must be denied`,
    )
    assert.equal(desktop.calls.length, 0)

    desktop.emit(snapshot({
      modules: [access(moduleId)],
      methods: [method],
    }))
    assert.equal(tools.definitions.has(toolName), true, `${moduleId} must re-register on fresh grant`)
    registry.dispose()
  }
})

test('disconnect and unavailable errors withdraw tools and are not retried', async () => {
  const tools = createTools()
  const desktop = createDesktop(snapshot({
    modules: [access('clipboard')],
    methods: ['agent.clipboard.list'],
  }), () => {
    throw Object.assign(new Error('disconnected'), { code: 'OUTCOME_UNKNOWN' })
  })
  const registry = createAgentToolRegistry({ tools, desktop })
  await registry.start(freshSignal())
  const listTool = tools.definitions.get('toolbox_clipboard')
  assert.ok(listTool)

  await assert.rejects(
    listTool.execute({ action: 'list' }, { signal: freshSignal() }),
    error => error.code === 'OUTCOME_UNKNOWN',
  )
  assert.deepEqual(tools.names(), [])
  assert.equal(desktop.calls.length, 1, 'no automatic retry')

  const accessFailure = createDesktop(snapshot({
    modules: [access('clipboard')],
    methods: ['agent.clipboard.list'],
  }))
  const failureRegistry = createAgentToolRegistry({ tools: createTools(), desktop: accessFailure })
  await failureRegistry.start(freshSignal())
  accessFailure.nextAccessError = Object.assign(new Error('unavailable'), { code: 'NATIVE_UNAVAILABLE' })
  const failureTools = failureRegistry.tools
  const remainingTool = failureTools.definitions.get('toolbox_clipboard')
  await assert.rejects(
    remainingTool.execute({ action: 'list' }, { signal: freshSignal() }),
    error => error.code === 'NATIVE_UNAVAILABLE',
  )
  assert.equal(failureTools.definitions.has('toolbox_clipboard'), false)
  assert.equal(accessFailure.calls.length, 0)
  failureRegistry.dispose()
})

test('pre-aborted and in-flight cancellation propagate without retry', async () => {
  const tools = createTools()
  let agentCalls = 0
  const desktop = createDesktop(snapshot({
    modules: [access('screenshot')],
    methods: ['agent.screenshot.monitors'],
  }), (_method, _params, options) => {
    agentCalls += 1
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  })
  const registry = createAgentToolRegistry({ tools, desktop })
  await registry.start(freshSignal())
  const tool = tools.definitions.get('toolbox_screenshot')

  const preAborted = new AbortController()
  preAborted.abort()
  await assert.rejects(
    tool.execute({ action: 'monitors' }, { signal: preAborted.signal }),
    { name: 'AbortError' },
  )
  assert.equal(agentCalls, 0)

  const controller = new AbortController()
  const pending = tool.execute({ action: 'monitors' }, { signal: controller.signal })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(agentCalls, 1, 'no automatic retry after cancellation')
  registry.dispose()
})

test('a registration failure in one module does not grant or block another module', async () => {
  const tools = createTools()
  const originalRegister = tools.register
  tools.register = definition => {
    if (definition.name === 'toolbox_screenshot') throw new Error('screenshot registration failed')
    return originalRegister(definition)
  }
  const desktop = createDesktop(snapshot({
    modules: [access('screenshot'), access('clipboard')],
    methods: ['agent.screenshot.monitors', 'agent.clipboard.list'],
  }))
  const registry = createAgentToolRegistry({ tools, desktop })
  await registry.start(freshSignal())

  assert.equal(tools.definitions.has('toolbox_screenshot'), false)
  assert.equal(tools.definitions.has('toolbox_clipboard'), true)
  assert.ok(registry.registrationErrors.has('screenshot'))
  assert.equal(tools.definitions.get('toolbox_clipboard').parameters.properties.action.enum.includes('monitors'), false)
  registry.dispose()
})

test('apply waits for toolboxDesktop, registers tools, and disposes with the injection scope', async () => {
  const tools = createTools()
  const desktop = createDesktop(snapshot({
    modules: [access('clipboard')],
    methods: ['agent.clipboard.list'],
  }))
  const effects = []
  let injected
  const ctx = {
    tools,
    get(name) {
      if (name === 'toolboxDesktop') return desktop
      if (name === 'tools') return tools
      return undefined
    },
    inject(services, callback) {
      if (services.length === 1 && services[0] === 'toolboxDesktop') injected = services
      callback({ ...ctx, toolboxDesktop: desktop })
      return () => {}
    },
    effect(factory) {
      const dispose = factory()
      effects.push(dispose)
      return dispose
    },
  }

  apply(ctx)
  await settle()

  assert.deepEqual(injected, ['toolboxDesktop'])
  assert.deepEqual(tools.names(), ['toolbox_clipboard'])
  assert.equal(desktop.listenerCount(), 1)

  for (const dispose of effects) if (typeof dispose === 'function') dispose()
  assert.deepEqual(tools.names(), [])
  assert.equal(desktop.listenerCount(), 0)
})

test('createAgentToolsForContext requires the toolboxDesktop service shape', () => {
  assert.throws(() => createAgentToolsForContext({
    tools: createTools(),
    toolboxDesktop: {},
  }), /toolboxDesktop/)
})
