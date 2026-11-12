import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolsService from '@deepseek-ai/dsh-tools';
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native';

export async function createPrototypeContext({ moduleUrl = new URL('../packages/dsh-toolbox/lib/index.js', import.meta.url).href } = {}) {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolsService);
  await ctx.plugin(NativeExecutor);
  await ctx.plugin(Loader, { baseUrl: new URL('../package.json', import.meta.url).href });
  const id = await ctx.loader.create({
    id: 'toolbox-prototype',
    name: moduleUrl,
    config: { label: 'DSH Toolbox' },
  });
  await ctx.loader.await();
  await ctx.loader.resolve(id).fiber.await();
  return { ctx, id };
}
