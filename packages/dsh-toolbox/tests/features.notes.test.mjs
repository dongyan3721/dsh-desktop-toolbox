import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
// Historical headless protocol regression; not a production entry point.
import { createNoteTools } from '../../../tests/fixtures/legacy-notes-tools.mjs'

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

test('note blank-text validation uses the same Unicode whitespace set as native Rust', async () => {
  const bridge = createFakeBridge()
  const create = tool(createNoteTools(bridge), 'toolbox_note_create')
  await assert.rejects(create.execute({ title: '\u0085', content_md: '' }, { signal: freshSignal() }), error => error.code === 'INVALID_REQUEST')
  assert.equal(bridge.calls.length, 0)
  await create.execute({ title: '\uFEFF', content_md: '' }, { signal: freshSignal() })
  assert.equal(bridge.calls[0].params.title, '\uFEFF')
})

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

  await search.execute({ query: '会议', limit: 20, offset: 10_000 }, { signal: freshSignal() })
  assert.deepEqual(bridge.calls[2].params, { query: '会议', limit: 20, offset: 10_000 })
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
    search.execute({ query: 'x', limit: 21 }, { signal: freshSignal() }),
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
  await assert.rejects(
    search.execute({ query: 'x', offset: 10_001 }, { signal: freshSignal() }),
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

test('note text limits count Unicode scalars and preserve valid original text', async () => {
  const bridge = createFakeBridge(method => (
    method === 'notes.search' ? { items: [], total: 0 } : noteRecord()
  ))
  const tools = createNoteTools(bridge)
  const create = tool(tools, 'toolbox_note_create')
  const search = tool(tools, 'toolbox_note_search')
  const update = tool(tools, 'toolbox_note_update')

  const title = '😀'.repeat(500)
  const content = '第一行\r\n\t第二行 😀'
  await create.execute({ title, content_md: content }, { signal: freshSignal() })
  assert.equal(bridge.calls[0].params.title, title)
  assert.equal(bridge.calls[0].params.content_md, content)

  const query = '🔎'.repeat(200)
  await search.execute({ query }, { signal: freshSignal() })
  assert.equal(bridge.calls[1].params.query, query)

  const id = '🆔'.repeat(80)
  await update.execute({ id, content_md: '' }, { signal: freshSignal() })
  assert.equal(bridge.calls[2].params.id, id)

  for (const [entry, args] of [
    [create, { title: '😀'.repeat(501), content_md: '' }],
    [search, { query: '🔎'.repeat(201) }],
    [update, { id: '🆔'.repeat(81), title: 'T' }],
  ]) {
    await assert.rejects(
      entry.execute(args, { signal: freshSignal() }),
      error => error.code === 'INVALID_REQUEST',
    )
  }
  assert.equal(bridge.calls.length, 3)
})

test('content_md accepts exactly the Unicode scalar limit and rejects one more', async () => {
  const bridge = createFakeBridge()
  const create = tool(createNoteTools(bridge), 'toolbox_note_create')
  const maximum = 'a'.repeat(1_048_576)

  await create.execute({ title: 'T', content_md: maximum }, { signal: freshSignal() })
  assert.equal(bridge.calls[0].params.content_md.length, 1_048_576)

  await assert.rejects(
    create.execute({ title: 'T', content_md: maximum + 'a' }, { signal: freshSignal() }),
    error => error.code === 'INVALID_REQUEST',
  )
  assert.equal(bridge.calls.length, 1)
})

test('unpaired surrogates and disallowed controls are rejected before the bridge', async () => {
  const bridge = createFakeBridge()
  const tools = createNoteTools(bridge)
  const create = tool(tools, 'toolbox_note_create')
  const search = tool(tools, 'toolbox_note_search')
  const update = tool(tools, 'toolbox_note_update')

  for (const [entry, args] of [
    [create, { title: 'bad\uD800', content_md: '' }],
    [create, { title: '\uDC00bad', content_md: '' }],
    [create, { title: 'T', content_md: 'bad\u0000' }],
    [create, { title: 'T', content_md: 'bad\u001F' }],
    [create, { title: 'line\nbreak', content_md: '' }],
    [create, { title: '　', content_md: '' }],
    [search, { query: 'bad\uD800' }],
    [search, { query: 'line\nbreak' }],
    [search, { query: '　' }],
    [update, { id: 'a\uD800', title: 'T' }],
    [update, { id: 'line\nbreak', title: 'T' }],
    [update, { id: 'note-1', title: 'bad\u001F' }],
  ]) {
    await assert.rejects(
      entry.execute(args, { signal: freshSignal() }),
      error => error.code === 'INVALID_REQUEST',
    )
  }
  assert.equal(bridge.calls.length, 0)

  const allowedContent = 'a\tb\r\nc'
  await create.execute({ title: 'T', content_md: allowedContent }, { signal: freshSignal() })
  assert.equal(bridge.calls[0].params.content_md, allowedContent)
})

test('real native StickyNoteRecord shapes are sanitized with safe integer boundaries', async () => {
  const nativeRecord = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: '真实记录',
    content_md: '# 标题\r\n正文\t',
    theme_color: 'sky',
    opacity: 1,
    pos_x: -2147483648,
    pos_y: 2147483647,
    width: 4294967295,
    height: 0,
    is_pinned: true,
    is_open: false,
    updated_at: 9007199254740991,
  }
  const bridge = createFakeBridge(() => ({
    items: [{ ...nativeRecord, created_at: 123, internal_field: 'ignored' }],
    total: 1,
  }))
  const search = tool(createNoteTools(bridge), 'toolbox_note_search')

  const value = await search.execute({ query: '真实' }, { signal: freshSignal() })

  assert.deepEqual(value, { items: [nativeRecord], total: 1 })
  assert.deepEqual(validateJsonSchemaValue(search.output.schema, value), [])
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)

  for (const overrides of [
    { updated_at: 9007199254740992 },
    { pos_x: 9007199254740992 },
    { width: 9007199254740992 },
    { opacity: Infinity },
  ]) {
    const badBridge = createFakeBridge(() => ({ items: [noteRecord(overrides)], total: 1 }))
    const badSearch = tool(createNoteTools(badBridge), 'toolbox_note_search')
    await assert.rejects(
      badSearch.execute({ query: 'x' }, { signal: freshSignal() }),
      error => error.code === 'INTERNAL',
    )
  }

  const badTotalBridge = createFakeBridge(() => ({ items: [], total: 9007199254740992 }))
  const badTotalSearch = tool(createNoteTools(badTotalBridge), 'toolbox_note_search')
  await assert.rejects(
    badTotalSearch.execute({ query: 'x' }, { signal: freshSignal() }),
    error => error.code === 'INTERNAL',
  )
})

test('an authoritative success survives a signal aborted after dispatch', async () => {
  const createController = new AbortController()
  let createCalls = 0
  const createBridge = {
    async request(_method, _params, options) {
      createCalls += 1
      assert.equal(options.signal, createController.signal)
      createController.abort()
      return noteRecord()
    },
  }
  const create = tool(createNoteTools(createBridge), 'toolbox_note_create')
  const created = await create.execute(
    { title: 'T', content_md: 'C' },
    { signal: createController.signal },
  )
  assert.equal(createController.signal.aborted, true)
  assert.deepEqual(created, noteRecord())
  assert.equal(createCalls, 1)

  const updateController = new AbortController()
  let updateCalls = 0
  const updatedRecord = noteRecord({ title: '已提交' })
  const updateBridge = {
    async request(_method, _params, options) {
      updateCalls += 1
      assert.equal(options.signal, updateController.signal)
      updateController.abort()
      return updatedRecord
    },
  }
  const update = tool(createNoteTools(updateBridge), 'toolbox_note_update')
  const updated = await update.execute(
    { id: 'note-1', title: '已提交' },
    { signal: updateController.signal },
  )
  assert.equal(updateController.signal.aborted, true)
  assert.deepEqual(updated, updatedRecord)
  assert.equal(updateCalls, 1)
})

test('CANCELLED, OUTCOME_UNKNOWN and other stable errors propagate without retry', async () => {
  for (const code of ['CANCELLED', 'OUTCOME_UNKNOWN', 'TIMEOUT', 'DISCONNECTED', 'INTERNAL']) {
    const failure = Object.assign(new Error(`native ${code}`), {
      code,
      causeCode: 'CANCELLED',
    })
    const bridge = createFakeBridge(() => { throw failure })
    const update = tool(createNoteTools(bridge), 'toolbox_note_update')

    await assert.rejects(
      update.execute({ id: 'note-1', title: 'T' }, { signal: freshSignal() }),
      error => error === failure && error.code === code,
    )
    assert.equal(bridge.calls.length, 1)
  }
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

test('legacy notes factory is a test-only fixture, not production source', () => {
  assert.equal(existsSync(new URL('../src/features/notes.js', import.meta.url)), false)
})
