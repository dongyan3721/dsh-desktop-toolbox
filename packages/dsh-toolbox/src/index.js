import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'dsh-toolbox';
export const inject = ['tools'];
export const Config = Schema.object({ label: Schema.string().default('DSH Toolbox') });

export function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'toolbox_status',
    description: '查看桌面工具箱接入状态；原型阶段不执行桌面操作。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          nativeConnected: { type: 'boolean', required: true },
          plannedModuleCount: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.label}：${value.phase}；原生连接尚未接入，计划迁移 ${value.plannedModuleCount} 个模块。` }],
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted();
      return { label: config.label, phase: 'prototype', nativeConnected: false, plannedModuleCount: 10 };
    },
  }));
}
