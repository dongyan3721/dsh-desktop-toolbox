import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentToolRegistry } from '../src/agent/registry.js'

const TEST_METHODS = [
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
]

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

function access(id) {
  return { id, agent_supported: true, agent_allowed: true, agent_effective: true }
}

function createDesktop(handler = () => ({ ok: true })) {
  const listeners = new Set()
  return {
    snapshot: {
      revision: 1,
      modules: ['screenshot', 'clipboard', 'screen_ink', 'app_usage'].map(access),
      methods: [...TEST_METHODS],
    },
    calls: [],
    async getAgentAccess() {
      return this.snapshot
    },
    async agentCall(method, params, options = {}) {
      this.calls.push({ method, params, options })
      options.signal?.throwIfAborted?.()
      return handler(method, params, options)
    },
    onAgentAccessChanged(listener) {
      listeners.add(listener)
      listener(this.snapshot)
      return () => listeners.delete(listener)
    },
  }
}

async function setup(handler) {
  const tools = createTools()
  const desktop = createDesktop(handler)
  const registry = createAgentToolRegistry({
    tools,
    desktop,
    imagePublisher: { async publish() { return {} } },
  })
  await registry.start(new AbortController().signal)
  return { tools, desktop, registry }
}

function freshSignal() {
  return new AbortController().signal
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, error => error.code === code)
}

test('closed action enums reject unadvertised actions before the service', async () => {
  const { tools, desktop, registry } = await setup()

  await rejectsWith(
    tools.definitions.get('toolbox_screenshot').execute({ action: 'delete' }, { signal: freshSignal() }),
    'INVALID_ARGS',
  )
  await rejectsWith(
    tools.definitions.get('toolbox_clipboard').execute({ action: 'read_image' }, { signal: freshSignal() }),
    'INVALID_ARGS',
  )
  await rejectsWith(
    tools.definitions.get('toolbox_screen_ink').execute({ action: 'paint' }, { signal: freshSignal() }),
    'INVALID_ARGS',
  )
  await rejectsWith(
    tools.definitions.get('toolbox_usage').execute({ action: 'delete' }, { signal: freshSignal() }),
    'INVALID_ARGS',
  )
  assert.equal(desktop.calls.length, 0)
  registry.dispose()
})

test('unknown, path, identity and method arguments are rejected globally', async () => {
  const { tools, desktop, registry } = await setup()

  await rejectsWith(
    tools.definitions.get('toolbox_screenshot').execute(
      { action: 'monitors', path: 'C:\\private\\shot.png' },
      { signal: freshSignal() },
    ),
    'INVALID_REQUEST',
  )
  await rejectsWith(
    tools.definitions.get('toolbox_clipboard').execute(
      { action: 'list', method: 'agent.clipboard.write_text' },
      { signal: freshSignal() },
    ),
    'INVALID_REQUEST',
  )
  await rejectsWith(
    tools.definitions.get('toolbox_usage').execute(
      { action: 'status', actor: 'human' },
      { signal: freshSignal() },
    ),
    'INVALID_REQUEST',
  )
  await assert.rejects(
    tools.definitions.get('toolbox_screen_ink').execute(
      {
        action: 'draw',
        strokes: [{ points: [{ x: 1, y: 2, z: 3 }], color: '#112233', width: 2 }],
      },
      { signal: freshSignal() },
    ),
    error => error.code === 'INVALID_REQUEST' || error.code === 'INVALID_ARGS',
  )
  assert.equal(desktop.calls.length, 0)
  registry.dispose()
})

test('screenshot monitor and region bounds are validated and mapped exactly', async () => {
  const { tools, desktop, registry } = await setup()
  const tool = tools.definitions.get('toolbox_screenshot')

  for (const args of [
    { action: 'capture', monitor_id: -1 },
    { action: 'capture', monitor_id: 0x100000000 },
    { action: 'capture', monitor_id: 1.5 },
    { action: 'capture', monitor_id: 1, region: { x: 0, y: 0, width: 0, height: 10 } },
    { action: 'capture', monitor_id: 1, region: { x: 0, y: 0, width: 10, height: 10, extra: 1 } },
    { action: 'capture', monitor_id: 1, region: { x: 0, y: 0, width: 10 } },
  ]) {
    await assert.rejects(tool.execute(args, { signal: freshSignal() }), error => (
      error.code === 'INVALID_REQUEST' || error.code === 'INVALID_ARGS'
    ))
  }
  assert.equal(desktop.calls.length, 0)

  const value = await tool.execute({
    action: 'capture',
    monitor_id: 0xFFFFFFFF,
    region: { x: -1920, y: -40, width: 800, height: 600 },
  }, { signal: freshSignal() })
  assert.deepEqual(value, {})
  assert.deepEqual(desktop.calls[0].params, {
    monitor_id: 0xFFFFFFFF,
    region: { x: -1920, y: -40, width: 800, height: 600 },
  })
  registry.dispose()
})

test('clipboard limits, keyword bytes and text size are bounded', async () => {
  const { tools, desktop, registry } = await setup()
  const tool = tools.definitions.get('toolbox_clipboard')

  await tool.execute({ action: 'list' }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls[0].params, { limit: 20 })

  await tool.execute({ action: 'list', keyword: '会议😀', limit: 100 }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls[1].params, { keyword: '会议😀', limit: 100 })

  for (const args of [
    { action: 'list', limit: 0 },
    { action: 'list', limit: 101 },
    { action: 'list', limit: 1.5 },
    { action: 'list', keyword: 'x'.repeat(201) },
    { action: 'list', keyword: 'line\nbreak' },
    { action: 'read_text', id: 0 },
    { action: 'read_text', id: -1 },
    { action: 'write_text', text: 'x'.repeat(65537) },
    { action: 'write_text', text: 'bad\u0001text' },
    { action: 'write_text', text: 'bad\uD800' },
  ]) {
    await assert.rejects(tool.execute(args, { signal: freshSignal() }), error => (
      error.code === 'INVALID_REQUEST' || error.code === 'INVALID_ARGS'
    ))
  }

  const maxText = 'a'.repeat(64 * 1024)
  await tool.execute({ action: 'write_text', text: maxText }, { signal: freshSignal() })
  assert.equal(desktop.calls.at(-1).params.text.length, 64 * 1024)

  const bounded = 'line1\r\n\tline2'
  await tool.execute({ action: 'write_text', text: bounded }, { signal: freshSignal() })
  assert.equal(desktop.calls.at(-1).params.text, bounded)
  registry.dispose()
})

test('usage dates are real, ordered and limited to 31 inclusive days', async () => {
  const { tools, desktop, registry } = await setup()
  const tool = tools.definitions.get('toolbox_usage')

  await tool.execute({
    action: 'overview',
    start_date: '2026-01-01',
    end_date: '2026-01-31',
  }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, { start_date: '2026-01-01', end_date: '2026-01-31' })

  await tool.execute({
    action: 'apps',
    start_date: '2024-02-29',
    end_date: '2024-02-29',
  }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, {
    start_date: '2024-02-29',
    end_date: '2024-02-29',
    limit: 20,
  })

  await tool.execute({ action: 'hourly', date: '2026-12-31' }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, { date: '2026-12-31' })

  for (const args of [
    { action: 'overview', start_date: '2026-02-30', end_date: '2026-03-01' },
    { action: 'overview', start_date: '2026-13-01', end_date: '2026-13-02' },
    { action: 'overview', start_date: '2026-1-01', end_date: '2026-01-02' },
    { action: 'overview', start_date: '2026-02-02', end_date: '2026-02-01' },
    { action: 'overview', start_date: '2026-01-01', end_date: '2026-02-01' },
    { action: 'hourly', date: '2026-02-29' },
    { action: 'apps', start_date: '2026-01-01', end_date: '2026-01-02', limit: 0 },
    { action: 'apps', start_date: '2026-01-01', end_date: '2026-01-02', limit: 101 },
  ]) {
    await assert.rejects(tool.execute(args, { signal: freshSignal() }), error => (
      error.code === 'INVALID_REQUEST' || error.code === 'INVALID_ARGS'
    ))
  }
  registry.dispose()
})

test('screen ink strokes are bounded and structurally closed', async () => {
  const { tools, desktop, registry } = await setup()
  const tool = tools.definitions.get('toolbox_screen_ink')

  const validStroke = { points: [{ x: 1.5, y: -2 }], color: '#1a2B3c', width: 2.5 }
  await tool.execute({ action: 'draw', strokes: [validStroke] }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, { strokes: [validStroke] })

  const onePoint = { points: [{ x: 1, y: 2 }], color: '#112233', width: 1 }
  await tool.execute({
    action: 'draw',
    strokes: Array.from({ length: 128 }, () => onePoint),
  }, { signal: freshSignal() })
  assert.equal(desktop.calls.at(-1).params.strokes.length, 128)

  const manyPoints = Array.from({ length: 4096 }, (_, index) => ({ x: index, y: index }))
  await tool.execute({
    action: 'draw',
    strokes: [
      { points: manyPoints, color: '#112233', width: 1 },
      { points: manyPoints, color: '#112233', width: 1 },
    ],
  }, { signal: freshSignal() })
  assert.equal(desktop.calls.at(-1).params.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0), 8192)

  for (const args of [
    { action: 'draw', strokes: [] },
    { action: 'draw', strokes: Array.from({ length: 129 }, () => onePoint) },
    {
      action: 'draw',
      strokes: [
        { points: manyPoints, color: '#112233', width: 1 },
        { points: [...manyPoints, { x: 0, y: 0 }], color: '#112233', width: 1 },
      ],
    },
    { action: 'draw', strokes: [{ points: [{ x: 1, y: 2 }], color: 'red', width: 1 }] },
    { action: 'draw', strokes: [{ points: [{ x: 1, y: 2 }], color: '#112233', width: 0 }] },
    { action: 'draw', strokes: [{ points: [{ x: 1, y: 2 }], color: '#112233', width: -1 }] },
    { action: 'draw', strokes: [{ points: [{ x: Infinity, y: 2 }], color: '#112233', width: 1 }] },
    { action: 'passthrough', enabled: 'yes' },
  ]) {
    await assert.rejects(tool.execute(args, { signal: freshSignal() }), error => (
      error.code === 'INVALID_REQUEST' || error.code === 'INVALID_ARGS'
    ))
  }
  registry.dispose()
})

test('canonical JSON results preserve module data without transformation', async () => {
  const payload = {
    revision: 7,
    items: [
      { id: 1, type: 'text', text: '会议纪要 😀\r\n第二行', created_at: 1760000000000 },
      { id: 2, type: 'url', preview: 'https://example.test/a?b=1' },
    ],
    total: 2,
    nullable: null,
    ratio: 0.25,
  }
  const { tools, desktop, registry } = await setup(() => payload)
  const tool = tools.definitions.get('toolbox_clipboard')

  const value = await tool.execute({ action: 'list' }, { signal: freshSignal() })
  assert.deepEqual(value, payload)
  assert.equal(desktop.calls[0].method, 'agent.clipboard.list')
  registry.dispose()
})
