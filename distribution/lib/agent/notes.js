import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  assertKnownKeys,
  invalidRequest,
  renderJson,
  renderText,
  requireInteger,
  requireString,
} from './common.js'

const MAX_ID_SCALARS = 80
const MAX_TITLE_SCALARS = 500
const MAX_QUERY_SCALARS = 200
const MAX_BODY_BYTES = 256 * 1024
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 20
const MAX_OFFSET = 10_000

function requireNoteId(value) {
  return requireString(value, 'id', {
    minScalars: 1,
    maxScalars: MAX_ID_SCALARS,
    nonWhitespace: true,
  })
}

function requireTitle(value) {
  return requireString(value, 'title', {
    minScalars: 1,
    maxScalars: MAX_TITLE_SCALARS,
    nonWhitespace: true,
  })
}

function requireBody(value) {
  const text = requireString(value, 'content_md', {
    maxScalars: MAX_BODY_BYTES,
    allowLineControls: true,
  })
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw invalidRequest(`content_md must be at most ${MAX_BODY_BYTES} UTF-8 bytes`)
  }
  return text
}

function requireQuery(value) {
  return requireString(value, 'query', { maxScalars: MAX_QUERY_SCALARS })
}

export function buildNotesParams(action, args) {
  if (action === 'search') {
    assertKnownKeys(args, ['action', 'query', 'limit', 'offset'])
    const params = {
      limit: args.limit === undefined
        ? DEFAULT_LIMIT
        : requireInteger(args.limit, 'limit', 1, MAX_LIMIT),
      offset: args.offset === undefined
        ? 0
        : requireInteger(args.offset, 'offset', 0, MAX_OFFSET),
    }
    if (args.query !== undefined) params.query = requireQuery(args.query)
    return params
  }
  if (action === 'read' || action === 'open') {
    assertKnownKeys(args, ['action', 'id'])
    return { id: requireNoteId(args.id) }
  }
  if (action === 'create') {
    assertKnownKeys(args, ['action', 'title', 'content_md'])
    const params = { title: requireTitle(args.title) }
    if (args.content_md !== undefined) params.content_md = requireBody(args.content_md)
    return params
  }
  if (action === 'update') {
    assertKnownKeys(args, ['action', 'id', 'expected_updated_at', 'title', 'content_md'])
    const params = {
      id: requireNoteId(args.id),
      expected_updated_at: requireInteger(args.expected_updated_at, 'expected_updated_at', 0),
    }
    let changed = false
    if (args.title !== undefined) {
      params.title = requireTitle(args.title)
      changed = true
    }
    if (args.content_md !== undefined) {
      params.content_md = requireBody(args.content_md)
      changed = true
    }
    if (!changed) throw invalidRequest('update requires title or content_md')
    return params
  }
  throw invalidRequest('unknown notes action')
}

function noteFromValue(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value.note !== null && typeof value.note === 'object' && !Array.isArray(value.note)
    ? value.note
    : value
}

function renderNotes(args, value) {
  if (args.action === 'search' && value !== null && typeof value === 'object' && Array.isArray(value.items)) {
    const items = value.items.slice(0, MAX_LIMIT)
    const lines = items.map(item => {
      const title = typeof item?.title === 'string' ? item.title : ''
      const state = item?.is_open === true ? '，已打开' : ''
      const version = Number.isSafeInteger(item?.updated_at) ? `，更新于 ${item.updated_at}` : ''
      return `- ${String(item?.id ?? '?')}：${title}${version}${state}`
    })
    const total = Number.isSafeInteger(value.total) ? value.total : items.length
    return renderText([`共 ${total} 条便笺。`, ...lines].join('\n'))
  }
  const note = noteFromValue(value)
  if (note !== undefined) {
    if (args.action === 'read') {
      const title = typeof note.title === 'string' ? note.title : ''
      const body = typeof note.content_md === 'string' ? note.content_md : ''
      return renderText(`${title}\n\n${body}`)
    }
    if (args.action === 'create' || args.action === 'update' || args.action === 'open') {
      const title = typeof note.title === 'string' ? note.title : ''
      const id = typeof note.id === 'string' ? note.id : ''
      if (args.action === 'create') return renderText(`已创建便笺「${title}」（${id}）。`)
      if (args.action === 'update') return renderText(`已更新便笺「${title}」（${id}）。`)
      const opened = value?.opened === true || note.is_open === true
      return renderText(opened ? `已打开便笺「${title}」（${id}）。` : `已请求打开便笺「${title}」（${id}）。`)
    }
  }
  return renderJson({ action: args.action, result: value })
}

export function createNotesTool(actions, run) {
  return defineTool({
    name: 'toolbox_notes',
    description: '搜索、读取、创建、更新或显式打开已授权的桌面便笺。读取返回共享便笺内容；更新必须带 expected_updated_at 并在冲突时保留用户编辑。',
    parameters: {
      action: {
        type: 'string',
        enum: actions,
        required: true,
        description: 'search/read/create/update/open',
      },
      query: { type: 'string', description: 'search 的可选关键词，最多 200 个 Unicode 字符' },
      limit: { type: 'integer', description: 'search 返回数量，1..20，默认 20' },
      offset: { type: 'integer', description: 'search 跳过数量，0..10000，默认 0' },
      id: { type: 'string', description: 'read/update/open 的便笺 ID，1..80 个 Unicode 字符' },
      title: { type: 'string', description: 'create/update 的标题，1..500 个 Unicode 字符' },
      content_md: { type: 'string', description: 'create/update 的 Markdown/LaTeX 正文，最多 256KiB UTF-8' },
      expected_updated_at: { type: 'integer', description: 'update 必填的最近更新时间戳（毫秒）' },
    },
    output: {
      schema: { type: 'json' },
      render: renderNotes,
    },
    async execute(args, exec) {
      const params = buildNotesParams(args.action, args)
      return run('sticky_note', args.action, params, exec)
    },
  })
}
