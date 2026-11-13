import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { isAbsolute, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { NativeOwner, hostError } from './host/native-owner.js';
import { createNoteTools } from './features/notes.js';
import { createImageTools } from './features/images.js';
import { authorizeImagePaths } from './host/image-policy.js';

export const name = 'dsh-toolbox';
export const inject = ['tools', 'subprocess'];
export const Config = Schema.object({
  label: Schema.string().default('DSH Toolbox'),
  dataDir: Schema.string().required(),
  nativeExecutable: Schema.string().default(''),
  startupTimeoutMs: Schema.number().default(15000),
  requestTimeoutMs: Schema.number().default(10000),
  cancelTimeoutMs: Schema.number().default(1500),
  shutdownTimeoutMs: Schema.number().default(3000),
  readRoots: Schema.array(Schema.string()).default([]),
  writeRoots: Schema.array(Schema.string()).default([]),
  enableImages: Schema.boolean().default(false),
  maxImageBytes: Schema.number().default(20 * 1024 * 1024),
});

export async function apply(ctx, config) {
  if (!isAbsolute(config.dataDir)) throw hostError('INVALID_CONFIG', 'Toolbox dataDir must be an absolute path');
  for (const field of ['startupTimeoutMs', 'requestTimeoutMs', 'cancelTimeoutMs', 'shutdownTimeoutMs']) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1 || config[field] > 2147483647) throw hostError('INVALID_CONFIG', `${field} must be a positive timer-safe integer`);
  }
  for (const root of [...config.readRoots, ...config.writeRoots]) {
    if (!isAbsolute(root)) throw hostError('INVALID_CONFIG', 'Native file roots must be absolute paths');
  }
  if (!Number.isSafeInteger(config.maxImageBytes) || config.maxImageBytes < 1) throw hostError('INVALID_CONFIG', 'maxImageBytes must be a positive safe integer');
  if (config.enableImages && (config.readRoots.length === 0 || config.writeRoots.length === 0 || !ctx.get('fs'))) throw hostError('INVALID_CONFIG', 'Images require a filesystem and explicit read/write roots');
  const tempDir = join(config.dataDir, '.tmp');
  await mkdir(tempDir, { recursive: true });
  const owner = new NativeOwner(ctx.subprocess, { ...config, tempDir });
  const contributions = [];
  const withdraw = () => { for (const dispose of contributions.splice(0)) dispose(); };
  ctx.effect(() => async () => { withdraw(); await owner.close(); });
  ctx.effect(() => owner.onUnavailable(withdraw));
  await owner.start();
  ctx.tools.register(defineTool({
    name: 'toolbox_status',
    description: '查看本机工具箱的真实连接状态和可用能力。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          nativeConnected: { type: 'boolean', required: true },
          nativeVersion: { type: 'string', required: true },
          capabilities: { type: 'array', items: { type: 'string' }, required: true },
          enabledModules: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.label}：${value.nativeConnected ? '已连接' : '不可用'}；可用模块：${value.enabledModules.join('、') || '无'}。` }],
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted();
      const connected = owner.ready && !owner.bridge.isClosed;
      if (!connected) return { label: config.label, phase: 'unavailable', nativeConnected: false, nativeVersion: '', capabilities: [], enabledModules: [] };
      const status = await owner.request('status', {}, { signal: exec.signal });
      return { label: config.label, phase: 'ready', nativeConnected: true, nativeVersion: status.nativeVersion, capabilities: [...owner.capabilities], enabledModules: status.modules.filter(module => module.available && module.enabled).map(module => module.id) };
    },
  }));
  const noteMethods = { toolbox_note_create: 'notes.create', toolbox_note_search: 'notes.search', toolbox_note_update: 'notes.update' };
  for (const tool of createNoteTools(owner)) {
    if (owner.capabilities.includes(noteMethods[tool.name])) contributions.push(ctx.tools.register(tool));
  }
  if (config.enableImages && owner.capabilities.includes('media.convert_image')) {
    const [definition] = createImageTools(owner);
    contributions.push(ctx.tools.register({
      ...definition,
      execute(args, exec) {
        const [call] = createImageTools(owner, { authorizePaths: request => authorizeImagePaths(ctx, config, request, exec) });
        return call.execute(args, exec);
      },
    }));
  }
}
