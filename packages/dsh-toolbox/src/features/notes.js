import { defineTool } from '@deepseek-ai/dsh-tools'

/**
 * Tool factories for the first-wave notes methods of the fixed bridge protocol.
 *
 * The factories only translate model-facing arguments to `notes.create`,
 * `notes.search` and `notes.update`. They never open a note window and never
 * touch storage directly; every side effect goes through the supplied client.
 */

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 100

const NULLABLE_INTEGER_SCHEMA = {
  oneOf: [
    { type: 'integer' },
    { type: 'null' },
  ],
}

/** Raw JSON Schema for the serialized native StickyNoteRecord. */
const NOTE_RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    content_md: { type: 'string', required: true },
    theme_color: { type: 'string', required: true },
    opacity: { type: 'number', required: true },
    pos_x: { ...NULLABLE_INTEGER_SCHEMA, required: true },
    pos_y: { ...NULLABLE_INTEGER_SCHEMA, required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    is_pinned: { type: 'boolean', required: true },
    is_open: { type: 'boolean', required: true },
    updated_at: { type: 'integer', required: true },
  },
}

const NOTE_SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: NOTE_RECORD_SCHEMA,
      required: true,
    },
    total: { type: 'integer', required: true },
  },
}

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function invalidRequest(message) {
  return fail('INVALID_REQUEST', message)
}

function requireBridge(bridge, factoryName) {
  if (bridge === null || typeof bridge !== 'object' || typeof bridge.request !== 'function') {
    throw new TypeError(`${factoryName} requires a bridge client with request(method, params, options)`)
  }
  return bridge
}

function requireSignal(exec) {
  const signal = exec?.signal
  if (signal === null || typeof signal !== 'object' || typeof signal.throwIfAborted !== 'function') {
    throw new TypeError('tool execution requires an AbortSignal in exec.signal')
  }
  return signal
}

function assertKnownArguments(input, allowed) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidRequest('arguments must be an object')
  }
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw invalidRequest(`unknown argument: ${key}`)
  }
}

function requireString(value, field) {
  if (typeof value !== 'string') throw invalidRequest(`${field} must be a string`)
  if (value.includes('\0')) throw invalidRequest(`${field} must not contain NUL`)
  return value
}

function requireNonEmptyString(value, field) {
  const text = requireString(value, field)
  if (text.trim() === '') throw invalidRequest(`${field} must not be empty`)
  return text
}

function requireInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value)) throw invalidRequest(`${field} must be a safe integer`)
  if (value < minimum) throw invalidRequest(`${field} must be at least ${minimum}`)
  if (maximum !== undefined && value > maximum) throw invalidRequest(`${field} must be at most ${maximum}`)
  return value
}

function normalizeNoteRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('INTERNAL', 'native bridge returned an invalid note record')
  }
  const opacity = value.opacity
  if (typeof opacity !== 'number' || !Number.isFinite(opacity)) {
    throw fail('INTERNAL', 'native bridge returned an invalid note record')
  }
  return {
    id: readString(value, 'id'),
    title: readString(value, 'title'),
    content_md: readString(value, 'content_md'),
    theme_color: readString(value, 'theme_color'),
    opacity,
    pos_x: readNullableSafeInteger(value, 'pos_x'),
    pos_y: readNullableSafeInteger(value, 'pos_y'),
    width: readSafeInteger(value, 'width'),
    height: readSafeInteger(value, 'height'),
    is_pinned: readBoolean(value, 'is_pinned'),
    is_open: readBoolean(value, 'is_open'),
    updated_at: readSafeInteger(value, 'updated_at'),
  }
}

function normalizeSearchResult(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.items)) {
    throw fail('INTERNAL', 'native bridge returned an invalid note search result')
  }
  if (!Number.isSafeInteger(value.total) || value.total < 0) {
    throw fail('INTERNAL', 'native bridge returned an invalid note search result')
  }
  return {
    items: value.items.map(normalizeNoteRecord),
    total: value.total,
  }
}

function readString(value, field) {
  if (typeof value[field] !== 'string') {
    throw fail('INTERNAL', `native bridge note record has an invalid ${field}`)
  }
  return value[field]
}

function readBoolean(value, field) {
  if (typeof value[field] !== 'boolean') {
    throw fail('INTERNAL', `native bridge note record has an invalid ${field}`)
  }
  return value[field]
}

function readSafeInteger(value, field) {
  if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
    throw fail('INTERNAL', `native bridge note record has an invalid ${field}`)
  }
  return value[field]
}

function readNullableSafeInteger(value, field) {
  if (value[field] === null) return null
  // Multi-monitor coordinates may legitimately be negative.
  if (!Number.isSafeInteger(value[field])) {
    throw fail('INTERNAL', `native bridge note record has an invalid ${field}`)
  }
  return value[field]
}

function formatUpdatedAt(updatedAt) {
  try {
    return new Date(updatedAt).toISOString()
  } catch {
    return String(updatedAt)
  }
}

export function createNoteTools(bridge) {
  requireBridge(bridge, 'createNoteTools')

  return [
    defineTool({
      name: 'toolbox_note_create',
      description: '创建一条桌面便笺并保存标题与 Markdown/LaTeX 正文。第一版只持久化便笺，不打开原生便笺窗口。',
      parameters: {
        title: { type: 'string', required: true, description: '便笺标题，不能为空' },
        content_md: { type: 'string', required: true, description: 'Markdown 与 LaTeX 混合正文，可以为空' },
        open: { type: 'boolean', const: false, description: '第一版仅接受 false；不会打开原生便笺窗口' },
      },
      output: {
        schema: NOTE_RECORD_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: `已创建便笺「${value.title}」（${value.id}），未打开原生窗口。` }]
        },
      },
      async execute(input, exec) {
        const signal = requireSignal(exec)
        signal.throwIfAborted()
        assertKnownArguments(input, ['title', 'content_md', 'open'])
        const title = requireNonEmptyString(input.title, 'title')
        const content_md = requireString(input.content_md, 'content_md')
        if (input.open !== undefined && input.open !== false) {
          throw invalidRequest('open:true is not supported by the first-wave notes tool')
        }
        const result = await bridge.request('notes.create', { title, content_md, open: false }, { signal })
        return normalizeNoteRecord(result)
      },
    }),

    defineTool({
      name: 'toolbox_note_search',
      description: '按关键词搜索已保存的桌面便笺，返回匹配记录与总数，支持分页。仅在用户明确需要时使用。',
      parameters: {
        query: { type: 'string', required: true, description: '非空搜索关键词' },
        limit: { type: 'integer', description: `返回条数，默认 ${DEFAULT_SEARCH_LIMIT}，最大 ${MAX_SEARCH_LIMIT}` },
        offset: { type: 'integer', description: '跳过条数，默认 0' },
      },
      output: {
        schema: NOTE_SEARCH_SCHEMA,
        render(_args, value) {
          if (value.items.length === 0) {
            return [{ type: 'text', text: `没有找到匹配的便笺（总数 ${value.total}）。` }]
          }
          const lines = value.items.map(item => `- ${item.title}（${item.id}，更新于 ${formatUpdatedAt(item.updated_at)}）`)
          return [{ type: 'text', text: [`共 ${value.total} 条匹配便笺，本页 ${value.items.length} 条：`, ...lines].join('\n') }]
        },
      },
      async execute(input, exec) {
        const signal = requireSignal(exec)
        signal.throwIfAborted()
        assertKnownArguments(input, ['query', 'limit', 'offset'])
        const query = requireNonEmptyString(input.query, 'query')
        const limit = input.limit === undefined
          ? DEFAULT_SEARCH_LIMIT
          : requireInteger(input.limit, 'limit', 1, MAX_SEARCH_LIMIT)
        const offset = input.offset === undefined
          ? 0
          : requireInteger(input.offset, 'offset', 0)
        const result = await bridge.request('notes.search', { query, limit, offset }, { signal })
        return normalizeSearchResult(result)
      },
    }),

    defineTool({
      name: 'toolbox_note_update',
      description: '更新指定便笺的标题或 Markdown/LaTeX 正文，可用最近更新时间检测并发冲突。不会打开原生便笺窗口。',
      parameters: {
        id: { type: 'string', required: true, description: '便笺 UUID' },
        title: { type: 'string', description: '新的便笺标题，不能为空' },
        content_md: { type: 'string', description: '新的 Markdown 与 LaTeX 混合正文' },
        expected_updated_at: { type: 'integer', description: '可选的最近更新时间戳（毫秒）；不匹配时返回 CONFLICT' },
      },
      output: {
        schema: NOTE_RECORD_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: `已更新便笺「${value.title}」（${value.id}）。` }]
        },
      },
      async execute(input, exec) {
        const signal = requireSignal(exec)
        signal.throwIfAborted()
        assertKnownArguments(input, ['id', 'title', 'content_md', 'expected_updated_at'])
        const id = requireNonEmptyString(input.id, 'id')
        const params = { id }
        let changed = false
        if (input.title !== undefined) {
          params.title = requireNonEmptyString(input.title, 'title')
          changed = true
        }
        if (input.content_md !== undefined) {
          params.content_md = requireString(input.content_md, 'content_md')
          changed = true
        }
        if (input.expected_updated_at !== undefined) {
          params.expected_updated_at = requireInteger(input.expected_updated_at, 'expected_updated_at', 0)
        }
        if (!changed) throw invalidRequest('at least one of title or content_md must be provided')
        const result = await bridge.request('notes.update', params, { signal })
        return normalizeNoteRecord(result)
      },
    }),
  ]
}
