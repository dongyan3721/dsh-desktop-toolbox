import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  assertKnownKeys,
  invalidRequest,
  renderJson,
  renderText,
  requireInteger,
  requireString,
} from './common.js'

const MAX_TEXT_BYTES = 64 * 1024
const MAX_KEYWORD_SCALARS = 200
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export function buildClipboardParams(action, args) {
  if (action === 'list') {
    assertKnownKeys(args, ['action', 'keyword', 'limit'])
    const params = {
      limit: args.limit === undefined
        ? DEFAULT_LIMIT
        : requireInteger(args.limit, 'limit', 1, MAX_LIMIT),
    }
    if (args.keyword !== undefined) {
      params.keyword = requireString(args.keyword, 'keyword', { maxScalars: MAX_KEYWORD_SCALARS })
    }
    return params
  }
  if (action === 'read_text') {
    assertKnownKeys(args, ['action', 'id'])
    return { id: requireInteger(args.id, 'id', 1) }
  }
  if (action === 'write_text') {
    assertKnownKeys(args, ['action', 'text'])
    const text = requireString(args.text, 'text', {
      maxScalars: MAX_TEXT_BYTES,
      allowLineControls: true,
    })
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
      throw invalidRequest(`text must be at most ${MAX_TEXT_BYTES} UTF-8 bytes`)
    }
    return { text }
  }
  throw invalidRequest('unknown clipboard action')
}

function renderClipboard(args, value) {
  if (args.action === 'read_text') {
    if (typeof value === 'string') return renderText(value.slice(0, MAX_TEXT_BYTES))
    if (value !== null && typeof value === 'object' && typeof value.text === 'string') {
      return renderText(value.text.slice(0, MAX_TEXT_BYTES))
    }
  }
  if (args.action === 'write_text') {
    return renderText('已写入剪贴板。')
  }
  return renderJson({ action: args.action, result: value })
}

export function createClipboardTool(actions, run) {
  return defineTool({
    name: 'toolbox_clipboard',
    description: '查询或读取已授权的剪贴板文本历史，或显式写入一段文本。不会自动粘贴，也不会读取图片或其他非文本内容。',
    parameters: {
      action: {
        type: 'string',
        enum: actions,
        required: true,
        description: 'list 查询历史；read_text 读取文本；write_text 写入文本',
      },
      keyword: { type: 'string', description: 'list 的可选搜索词，最多 200 个 Unicode 字符' },
      limit: { type: 'integer', description: 'list 返回数量，1..100，默认 20' },
      id: { type: 'integer', description: 'read_text 的剪贴板条目 ID，正整数' },
      text: { type: 'string', description: 'write_text 的文本，最多 65536 UTF-8 字节' },
    },
    output: {
      schema: { type: 'json' },
      render: renderClipboard,
    },
    async execute(args, exec) {
      const params = buildClipboardParams(args.action, args)
      return run('clipboard', args.action, params, exec)
    },
  })
}
