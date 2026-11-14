import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  assertKnownKeys,
  invalidRequest,
  renderJson,
  requireDate,
  requireDateRange,
  requireInteger,
} from './common.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export function buildUsageParams(action, args) {
  if (action === 'status') {
    assertKnownKeys(args, ['action'])
    return {}
  }
  if (action === 'overview') {
    assertKnownKeys(args, ['action', 'start_date', 'end_date'])
    return requireDateRange(args.start_date, args.end_date)
  }
  if (action === 'apps') {
    assertKnownKeys(args, ['action', 'start_date', 'end_date', 'limit'])
    return {
      ...requireDateRange(args.start_date, args.end_date),
      limit: args.limit === undefined
        ? DEFAULT_LIMIT
        : requireInteger(args.limit, 'limit', 1, MAX_LIMIT),
    }
  }
  if (action === 'hourly') {
    assertKnownKeys(args, ['action', 'date'])
    return { date: requireDate(args.date, 'date').value }
  }
  throw invalidRequest('unknown app usage action')
}

export function createUsageTool(actions, run) {
  return defineTool({
    name: 'toolbox_usage',
    description: '查询已授权的应用使用时长共享统计，包括状态、日期范围概览、按应用统计和按小时统计。不会开启或修改采样设置。',
    parameters: {
      action: {
        type: 'string',
        enum: actions,
        required: true,
        description: 'status/overview/apps/hourly',
      },
      start_date: { type: 'string', description: '起始日期 YYYY-MM-DD（含）' },
      end_date: { type: 'string', description: '结束日期 YYYY-MM-DD（含），范围最多 31 天' },
      date: { type: 'string', description: 'hourly 的单日日期 YYYY-MM-DD' },
      limit: { type: 'integer', description: 'apps 返回数量，1..100，默认 20' },
    },
    output: {
      schema: { type: 'json' },
      render(args, value) {
        return renderJson({ action: args.action, result: value })
      },
    },
    async execute(args, exec) {
      const params = buildUsageParams(args.action, args)
      return run('app_usage', args.action, params, exec)
    },
  })
}
