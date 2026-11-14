import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  assertKnownKeys,
  invalidRequest,
  renderAgentImage,
  renderJson,
  requireInteger,
} from './common.js'

const UINT32_MAX = 0xFFFFFFFF
const INT32_MIN = -0x80000000
const INT32_MAX = 0x7FFFFFFF

const REGION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'integer', required: true, description: '物理像素 X 坐标，相对所选显示器' },
    y: { type: 'integer', required: true, description: '物理像素 Y 坐标，相对所选显示器' },
    width: { type: 'integer', required: true, description: '物理像素宽度，必须大于 0' },
    height: { type: 'integer', required: true, description: '物理像素高度，必须大于 0' },
  },
}

export function buildScreenshotParams(action, args) {
  if (action === 'monitors') {
    assertKnownKeys(args, ['action'])
    return {}
  }
  if (action === 'capture') {
    assertKnownKeys(args, ['action', 'monitor_id', 'region'])
    const monitorId = requireInteger(args.monitor_id, 'monitor_id', 0, UINT32_MAX)
    if (args.region === undefined) return { monitor_id: monitorId }
    const region = args.region
    assertKnownKeys(region, ['x', 'y', 'width', 'height'])
    return {
      monitor_id: monitorId,
      region: {
        x: requireInteger(region.x, 'region.x', INT32_MIN, INT32_MAX),
        y: requireInteger(region.y, 'region.y', INT32_MIN, INT32_MAX),
        width: requireInteger(region.width, 'region.width', 1, UINT32_MAX),
        height: requireInteger(region.height, 'region.height', 1, UINT32_MAX),
      },
    }
  }
  throw invalidRequest('unknown screenshot action')
}

export function createScreenshotTool(actions, run) {
  return defineTool({
    name: 'toolbox_screenshot',
    description: '查看已授权的显示器信息，或捕获指定显示器的物理像素区域。截图需要用户开启功能并单独授权 Agent 访问。',
    parameters: {
      action: {
        type: 'string',
        enum: actions,
        required: true,
        description: 'monitors 枚举显示器；capture 捕获图像',
      },
      monitor_id: { type: 'integer', description: 'capture 时的显示器 ID（uint32）' },
      region: REGION_SCHEMA,
    },
    output: {
      schema: { type: 'json' },
      render(args, value) {
        if (args.action === 'capture') return renderAgentImage(value, '截图已附加为图像')
        return renderJson({ action: args.action, result: value })
      },
    },
    async execute(args, exec) {
      const params = buildScreenshotParams(args.action, args)
      return run('screenshot', args.action, params, exec)
    },
  })
}
