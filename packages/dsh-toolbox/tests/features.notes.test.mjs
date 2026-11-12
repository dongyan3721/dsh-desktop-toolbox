import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { createNoteTools } from '../src/features/notes.js'

function noteRecord(overrides = {}) {
  return {
    id: 'note-1',
    title: '会议记录',
    content_md: '# 议程\n\n- 第一项',
    theme_color: 'amber',
    opacity: 0.9,
    pos_x: null,
    pos_y: null,
    width: 320,
    height: 240,
    is_pinned: false,
    is_open: false,
    updated_at: 1_760_000_000_000,
    ...overrides,
  }
}

function createFakeBridge(handler = () => noteRecord()) {
  const calls = []
  return {
    calls,
    async request(method, params, options) {
      calls.push({ method, params, options })
      return handler(method, params, options)
    },
  }
}

function tool(tools, name) {
  const found = tools.find(entry => entry.name === name)
  assert.ok(found, `expected ${name}`)
  return found
}

function freshSignal() {
  return new AbortController().signal
}

test('createNoteTools exposes the three first-wave note tools', () => {
  const tools = createNoteTools(createFakeBridge())
  assert.deepEqual(tools.map(entry => entry.name), [
    'toolbox_note_create',
    'toolbox_note_search',
    'toolbox_note_update',
  ])
})

test('createNoteTools rejects a missing or malformed bridge', () => {
  assert.throws(() => createNoteTools(null), TypeError)
  assert.throws(() => createNoteTools({}), TypeError)
})

test('note create maps to notes.create with open:false and returns a normal record', async () => {
  const bridge = createFakeBridge(() => noteRecord())
  const create = tool(createNoteTools(bridge), 'toolbox_note_create')
  const signal = freshSignal()

  const value = await create.execute({ title: '会议记录', content_md: '# 议程' }, { signal })

  assert.equal(bridge.calls.length, 1)
  assert.equal(bridge.calls[0].method, 'notes.create')
  assert.deepEqual(bridge.calls[0].params, {
    title: '会议记录',
    content_md: '# 议程',
    open: false,
  })
  assert.equal(bridge.calls[0].options.signal, signal)
  assert.deepEqual(value, noteRecord())
  assert.deepEqual(validateJsonSchemaValue(create.output.schema, value), [])
})

test('note create preserves user text and accepts only open:false', async () => {
  const bridge = createFakeBridge()
  const create = tool(createNoteTools(bridge), 'toolbox_note_create')

  await create.execute(
    { title: '  保留空格  ', content_md: '  正文  ', open: false },
    { signal: freshSignal() },
  )
  assert.equal(bridge.calls[0].params.title, '  保留空格  ')
  assert.equal(bridge.calls[0].params.content_md, '  正文  ')
  assert.equal(bridge.calls[0].params.open, false)

  await assert.rejects(
    create.execute({ title: 'T', content_md: 'C', open: true }, { signal: freshSignal() }),
    error => error.code === 'INVALID_ARGS',
  )
  assert.equal(bridge.calls.length, 1)
})

test('note create schema and domain checks reject invalid input without calling the bridge', async () => {
  const bridge = createFakeBridge()
  const create = tool(createNoteTools(bridge), 'toolbox_note_create')

  await assert.rejects(
    create.execute({ content_md: '正文' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_ARGS',
  )
  await assert.rejects(
    create.execute({ title: 'T', content_md: 42 }, { signal: freshSignal() }),
    error => error.code === 'INVALID_ARGS',
  )
  await assert.rejects(
    create.execute({ title: '   ', content_md: '正文' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  await assert.rejects(
    create.execute({ title: 'T', content_md: 'C', extra: true }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  assert.equal(bridge.calls.length, 0)
})

test('note create propagates bridge errors unchanged', async () => {
  const failure = Object.assign(new Error('版本冲突'), { code: 'CONFLICT' })
  const bridge = createFakeBridge(() => { throw failure })
  const create = tool(createNoteTools(bridge), 'toolbox_note_create')

  await assert.rejects(
    create.execute({ title: 'T', content_md: 'C' }, { signal: freshSignal() }),
    error => error === failure,
  )
})

test('note create rejects an invalid native record without leaking it', async () => {
  const bridge = createFakeBridge(() => ({ id: 'note-1', title: 'only two fields' }))
  const create = tool(createNoteTools(bridge), 'toolbox_note_create')

  await assert.rejects(
    create.execute({ title: 'T', content_md: 'C' }, { signal: freshSignal() }),
    error => error.code === 'INTERNAL' && !error.message.includes('only two fields'),
  )
})

test('note search maps query and pagination, defaulting limit and offset', async () => {
  const record = noteRecord({ pos_x: -1920, pos_y: -40 })
  const bridge = createFakeBridge(() => ({ items: [record], total: 1 }))
  const search = tool(createNoteTools(bridge), 'toolbox_note_search')
  const signal = freshSignal()

  const value = await search.execute({ query: '会议' }, { signal })

  assert.deepEqual(bridge.calls[0].params, { query: '会议', limit: 20, offset: 0 })
  assert.equal(bridge.calls[0].options.signal, signal)
  assert.deepEqual(value, { items: [record], total: 1 })
  assert.equal(value.items[0].pos_x, -1920)
  assert.deepEqual(validateJsonSchemaValue(search.output.schema, value), [])

  await search.execute({ query: '会议', limit: 5, offset: 10 }, { signal: freshSignal() })
  assert.deepEqual(bridge.calls[1].params, { query: '会议', limit: 5, offset: 10 })
})

test('note search validates query, limit and offset before the bridge', async () => {
  const bridge = createFakeBridge(() => ({ items: [], total: 0 }))
  const search = tool(createNoteTools(bridge), 'toolbox_note_search')

  await assert.rejects(
    search.execute({ query: '   ' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  await assert.rejects(
    search.execute({ query: 'x', limit: 0 }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  await assert.rejects(
    search.execute({ query: 'x', limit: 101 }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  await assert.rejects(
    search.execute({ query: 'x', limit: 1.5 }, { signal: freshSignal() }),
    error => error.code === 'INVALID_ARGS',
  )
  await assert.rejects(
    search.execute({ query: 'x', offset: -1 }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  assert.equal(bridge.calls.length, 0)
})

test('note search rejects an invalid native result shape', async () => {
  const bridge = createFakeBridge(() => ({ items: 'not-an-array', total: 0 }))
  const search = tool(createNoteTools(bridge), 'toolbox_note_search')

  await assert.rejects(
    search.execute({ query: 'x' }, { signal: freshSignal() }),
    error => error.code === 'INTERNAL',
  )
})

test('note update maps optional fields and expected timestamp exactly', async () => {
  const bridge = createFakeBridge(() => noteRecord({ title: '新标题' }))
  const update = tool(createNoteTools(bridge), 'toolbox_note_update')

  await update.execute({ id: 'note-1', title: '新标题' }, { signal: freshSignal() })
  assert.deepEqual(bridge.calls[0].params, { id: 'note-1', title: '新标题' })

  await update.execute({
    id: 'note-1',
    content_md: '',
    expected_updated_at: 1_760_000_000_000,
  }, { signal: freshSignal() })
  assert.deepEqual(bridge.calls[1].params, {
    id: 'note-1',
    content_md: '',
    expected_updated_at: 1_760_000_000_000,
  })
})

test('note update requires a change and validates its inputs', async () => {
  const bridge = createFakeBridge(() => noteRecord())
  const update = tool(createNoteTools(bridge), 'toolbox_note_update')

  await assert.rejects(
    update.execute({ id: 'note-1' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  await assert.rejects(
    update.execute({ id: 'note-1', title: '   ' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  await assert.rejects(
    update.execute({ id: 'note-1', expected_updated_at: 1.5, title: 'T' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_ARGS',
  )
  await assert.rejects(
    update.execute({ id: '', title: 'T' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  assert.equal(bridge.calls.length, 0)
})

test('note update propagates CONFLICT from the bridge', async () => {
  const failure = Object.assign(new Error('expected_updated_at mismatch'), { code: 'CONFLICT' })
  const bridge = createFakeBridge(() => { throw failure })
  const update = tool(createNoteTools(bridge), 'toolbox_note_update')

  await assert.rejects(
    update.execute({ id: 'note-1', title: 'T', expected_updated_at: 1 }, { signal: freshSignal() }),
    error => error === failure,
  )
})

test('pre-aborted calls reject before the bridge is used', async () => {
  const bridge = createFakeBridge()
  const tools = createNoteTools(bridge)
  const controller = new AbortController()
  controller.abort()

  for (const [entry, args] of [
    [tool(tools, 'toolbox_note_create'), { title: 'T', content_md: 'C' }],
    [tool(tools, 'toolbox_note_search'), { query: 'x' }],
    [tool(tools, 'toolbox_note_update'), { id: 'note-1', title: 'T' }],
  ]) {
    await assert.rejects(entry.execute(args, { signal: controller.signal }), { name: 'AbortError' })
  }
  assert.equal(bridge.calls.length, 0)
})

test('in-flight cancellation is forwarded through exec.signal', async () => {
  let receivedSignal
  const bridge = {
    request(_method, _params, options) {
      receivedSignal = options.signal
      return new Promise((_resolve, reject) => {
        if (options.signal.aborted) {
          reject(options.signal.reason)
          return
        }
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    },
  }
  const create = tool(createNoteTools(bridge), 'toolbox_note_create')
  const controller = new AbortController()

  const pending = create.execute({ title: 'T', content_md: 'C' }, { signal: controller.signal })
  assert.equal(receivedSignal, controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('note renderers are pure and do not call the bridge', () => {
  const bridge = createFakeBridge()
  const tools = createNoteTools(bridge)
  const create = tool(tools, 'toolbox_note_create')
  const search = tool(tools, 'toolbox_note_search')
  const update = tool(tools, 'toolbox_note_update')

  const created = create.output.render({ title: 'T', content_md: 'C' }, noteRecord())
  const searched = search.output.render({ query: '会议' }, { items: [noteRecord()], total: 1 })
  const updated = update.output.render({ id: 'note-1', title: 'T' }, noteRecord())

  assert.equal(created[0].type, 'text')
  assert.match(created[0].text, /已创建便笺/)
  assert.match(searched[0].text, /共 1 条匹配便笺/)
  assert.equal(searched[0].text.includes('# 议程'), false)
  assert.match(updated[0].text, /已更新便笺/)
  assert.equal(bridge.calls.length, 0)
})
