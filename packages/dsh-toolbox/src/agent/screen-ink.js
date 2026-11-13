import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  assertKnownKeys,
  invalidRequest,
  renderJson,
  renderText,
  requireArray,
  requireBoolean,
  requireNumber,
  requireString,
} from './common.js'

const MAX_STROKES = 128
const MAX_POINTS = 8192
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u
const EMPTY_ACTIONS = new Set(['status', 'start', 'stop', 'clear', 'snapshot'])

function validateStroke(stroke, index) {
  assertKnownKeys(stroke, ['points', 'color', 'width'])
  const points = requireArray(stroke.points, `strokes[${index}].points`, 1, MAX_POINTS)
  const normalizedPoints = points.map((point, pointIndex) => {
    assertKnownKeys(point, ['x', 'y'])
    return {
      x: requireNumber(point.x, `strokes[${index}].points[${pointIndex}].x`),
      y: requireNumber(point.y, `strokes[${index}].points[${pointIndex}].y`),
    }
  })
  const color = requireString(stroke.color, `strokes[${index}].color`, { minScalars: 7, maxScalars: 7 })
  if (!COLOR_PATTERN.test(color)) throw invalidRequest(`strokes[${index}].color must use #RRGGBB`)
  return {
    points: normalizedPoints,
    color,
    width: requireNumber(stroke.width, `strokes[${index}].width`, Number.MIN_VALUE),
  }
}

export function buildScreenInkParams(action, args) {
  if (EMPTY_ACTIONS.has(action)) {
    assertKnownKeys(args, ['action'])
    return {}
  }
  if (action === 'passthrough') {
    assertKnownKeys(args, ['action', 'enabled'])
    return { enabled: requireBoolean(args.enabled, 'enabled') }
  }
  if (action === 'draw') {
    assertKnownKeys(args, ['action', 'strokes'])
    const strokes = requireArray(args.strokes, 'strokes', 1, MAX_STROKES)
    const normalized = strokes.map(validateStroke)
    const pointCount = normalized.reduce((sum, stroke) => sum + stroke.points.length, 0)
    if (pointCount > MAX_POINTS) throw invalidRequest(`strokes must contain at most ${MAX_POINTS} points in total`)
    return { strokes: normalized }
  }
  throw invalidRequest('unknown screen ink action')
}

function renderScreenInk(args, value) {
  if (args.action === 'draw' && value !== null && typeof value === 'object') {
    if (Number.isSafeInteger(value.applied)) {
      const revision = Number.isSafeInteger(value.revision) ? `，画布版本 ${value.revision}` : ''
      return renderText(`已应用 ${value.applied} 条笔画${revision}。`)
    }
  }
  return renderJson({ action: args.action, result: value })
}

export function createScreenInkTool(actions, run) {
  return defineTool({
    name: 'toolbox_screen_ink',
    description: '操作已授权的共享屏幕注释会话：查看状态、开始/结束、切换穿透、清空、绘制结构化笔画或获取当前画布快照。',
    parameters: {
      action: {
        type: 'string',
        enum: actions,
        required: true,
        description: 'status/start/stop/passthrough/clear/draw/snapshot',
      },
      enabled: { type: 'boolean', description: 'passthrough 的目标状态' },
      strokes: {
        type: 'array',
        description: 'draw 的结构化笔画；最多 128 条、合计 8192 个点',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            points: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  x: { type: 'number', required: true },
                  y: { type: 'number', required: true },
                },
              },
            },
            color: { type: 'string', required: true, description: '#RRGGBB' },
            width: { type: 'number', required: true },
          },
        },
      },
    },
    output: {
      schema: { type: 'json' },
      render: renderScreenInk,
    },
    async execute(args, exec) {
      const params = buildScreenInkParams(args.action, args)
      return run('screen_ink', args.action, params, exec)
    },
  })
}
