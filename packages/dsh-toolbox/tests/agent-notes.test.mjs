import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentToolRegistry } from '../src/agent/registry.js'

const NOTES_METHODS = [
  'agent.notes.search',
  'agent.notes.read',
  'agent.notes.create',
  'agent.notes.update',
  'agent.notes.open',
]

const NOTE = {
  id: 'note-1',
  title: '会议记录',
  content_md: '# 议程\n\n- 第一项 😀',
  is_open: false,
  updated_at: 1_760_000_000_000,
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

function createDesktop(handler = () => NOTE, overrides = {}) {
  const listeners = new Set()
  return {
    snapshot: {
      revision: 1,
      modules: [{
        id: 'sticky_note',
        agent_supported: true,
        agent_allowed: true,
        agent_effective: true,
      }],
      methods: [...NOTES_METHODS],
      ...overrides,
    },
    calls: [],
    accessCalls: 0,
    async getAgentAccess() {
      this.accessCalls += 1
      return this.snapshot
    },
    async agentCall(method, params, options = {}) {
      this.calls.push({ method, params, options })
      return handler(method, params, options)
    },
    onAgentAccessChanged(listener) {
      listeners.add(listener)
      listener(this.snapshot)
      return () => listeners.delete(listener)
    },
    emit(snapshot) {
      this.snapshot = snapshot
      for (const listener of listeners) listener(snapshot)
    },
  }
}

async function setup(handler, overrides) {
  const tools = createTools()
  const desktop = createDesktop(handler, overrides)
  const registry = createAgentToolRegistry({ tools, desktop })
  await registry.start(new AbortController().signal)
  return { tools, desktop, registry, tool: tools.definitions.get('toolbox_notes') }
}

function freshSignal() {
  return new AbortController().signal
}

test('toolbox_notes exposes only the five fixed actions', async () => {
  const { tools, registry } = await setup()
  const tool = tools.definitions.get('toolbox_notes')
  assert.ok(tool)
  assert.deepEqual(tool.parameters.properties.action.enum, ['search', 'read', 'create', 'update', 'open'])
  assert.deepEqual(tools.definitions.size, 1)
  registry.dispose()
})

test('notes search defaults, limits and closed arguments are enforced', async () => {
  const { tool, desktop, registry } = await setup()

  await tool.execute({ action: 'search' }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, { limit: 20, offset: 0 })

  await tool.execute({ action: 'search', query: '会议😀', limit: 20, offset: 10_000 }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, { limit: 20, offset: 10_000, query: '会议😀' })

  for (const args of [
    { action: 'search', query: 'x'.repeat(201) },
    { action: 'search', query: 'line\nbreak' },
    { action: 'search', limit: 0 },
    { action: 'search', limit: 21 },
    { action: 'search', offset: -1 },
    { action: 'search', offset: 10_001 },
    { action: 'search', path: 'C:\\notes.db' },
    { action: 'read', id: '' },
    { action: 'read', id: 'x'.repeat(81) },
    { action: 'read', id: 'bad\uD800' },
    { action: 'open', id: '   ' },
  ]) {
    await assert.rejects(tool.execute(args, { signal: freshSignal() }), error => (
      error.code === 'INVALID_REQUEST' || error.code === 'INVALID_ARGS'
    ))
  }
  registry.dispose()
})

test('notes create/update/open map exactly and update requires CAS plus one change', async () => {
  const { tool, desktop, registry } = await setup()

  await tool.execute({ action: 'read', id: 'note-1' }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, { id: 'note-1' })

  await tool.execute({ action: 'open', id: 'note-1' }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, { id: 'note-1' })

  await tool.execute({
    action: 'create',
    title: '  保留标题  ',
    content_md: '# 正文\r\n\t😀',
  }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, {
    title: '  保留标题  ',
    content_md: '# 正文\r\n\t😀',
  })

  await tool.execute({
    action: 'update',
    id: 'note-1',
    expected_updated_at: 0,
    title: '新标题',
    content_md: '',
  }, { signal: freshSignal() })
  assert.deepEqual(desktop.calls.at(-1).params, {
    id: 'note-1',
    expected_updated_at: 0,
    title: '新标题',
    content_md: '',
  })

  for (const args of [
    { action: 'update', id: 'note-1', title: 'T' },
    { action: 'update', id: 'note-1', expected_updated_at: 1 },
    { action: 'update', id: 'note-1', expected_updated_at: -1, title: 'T' },
    { action: 'update', id: 'note-1', expected_updated_at: 1.5, title: 'T' },
    { action: 'create', title: '   ' },
    { action: 'create', title: 'T', content_md: 'bad\u0001' },
    { action: 'create', title: 'T', content_md: 'bad\uD800' },
    { action: 'create', title: 'T', content_md: 'x'.repeat(256 * 1024 + 1) },
    { action: 'create', title: 'T', content_md: '', method: 'agent.notes.update' },
    { action: 'open', id: 'note-1', actor: 'human' },
  ]) {
    await assert.rejects(tool.execute(args, { signal: freshSignal() }), error => (
      error.code === 'INVALID_REQUEST' || error.code === 'INVALID_ARGS'
    ))
  }
  registry.dispose()
})

test('notes body preserves Markdown/Unicode at the byte boundary', async () => {
  const { tool, desktop, registry } = await setup()
  const body = 'a'.repeat(256 * 1024)
  await tool.execute({ action: 'create', title: 'T', content_md: body }, { signal: freshSignal() })
  assert.equal(desktop.calls.at(-1).params.content_md.length, 256 * 1024)

  const unicode = '# 标题\n\n公式 $x^2$ 与 😀\r\n\t结束'
  await tool.execute({ action: 'update', id: 'note-1', expected_updated_at: 7, content_md: unicode }, { signal: freshSignal() })
  assert.equal(desktop.calls.at(-1).params.content_md, unicode)
  registry.dispose()
})

test('notes conflict and unknown outcomes propagate without retry', async () => {
  let calls = 0
  const { tool, registry } = await setup((method) => {
    calls += 1
    if (method === 'agent.notes.update') {
      throw Object.assign(new Error('stale version'), { code: 'CONFLICT' })
    }
    return NOTE
  })
  await assert.rejects(
    tool.execute({
      action: 'update',
      id: 'note-1',
      expected_updated_at: 1,
      title: '新标题',
    }, { signal: freshSignal() }),
    error => error.code === 'CONFLICT',
  )
  assert.equal(calls, 1)
  registry.dispose()

  let unknownCalls = 0
  const unknown = await setup(() => {
    unknownCalls += 1
    throw Object.assign(new Error('outcome unknown'), { code: 'OUTCOME_UNKNOWN' })
  })
  await assert.rejects(
    unknown.tool.execute({
      action: 'update',
      id: 'note-1',
      expected_updated_at: 1,
      title: '新标题',
    }, { signal: freshSignal() }),
    error => error.code === 'OUTCOME_UNKNOWN',
  )
  assert.equal(unknownCalls, 1, 'unknown write outcome must not be retried')
  unknown.registry.dispose()
})

test('a committed note update survives a late cancellation and is not retried', async () => {
  const controller = new AbortController()
  const { tool, desktop, registry } = await setup(() => {
    controller.abort()
    return { ...NOTE, title: '已提交', updated_at: 1_760_000_000_001 }
  })

  const value = await tool.execute({
    action: 'update',
    id: 'note-1',
    expected_updated_at: 1_759_999_999_999,
    title: '已提交',
  }, { signal: controller.signal })

  assert.equal(value.title, '已提交')
  assert.equal(desktop.calls.length, 1)
  assert.equal(controller.signal.aborted, true)
  registry.dispose()
})

test('notes rendering is bounded and does not claim an unopened note is open', async () => {
  const { tool, registry } = await setup()
  const read = tool.output.render(
    { action: 'read' },
    { note: { title: '标题', content_md: '# 正文 😀' } },
  )
  assert.equal(read[0].type, 'text')
  assert.match(read[0].text, /标题/)
  assert.match(read[0].text, /# 正文 😀/)

  const search = tool.output.render(
    { action: 'search' },
    { items: [NOTE], total: 1 },
  )
  assert.match(search[0].text, /note-1/)
  assert.equal(search[0].text.includes(NOTE.content_md), false)

  const open = tool.output.render(
    { action: 'open' },
    { ...NOTE, opened: false, is_open: false },
  )
  assert.match(open[0].text, /已请求打开便笺/)
  assert.equal(open[0].text.includes('已打开便笺'), false)
  registry.dispose()
})
