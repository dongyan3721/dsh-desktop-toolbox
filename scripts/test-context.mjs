import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolsService from '@deepseek-ai/dsh-tools';
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

export async function createToolboxContext({
  moduleUrl = new URL('../tests/fixtures/legacy-headless-plugin.mjs', import.meta.url).href,
  dataDir = fileURLToPath(new URL(`../runtime/loader-tests/${randomUUID()}/`, import.meta.url)),
  config = {},
} = {}) {
  await mkdir(dataDir, { recursive: true });
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolsService);
    await ctx.plugin(NativeExecutor);
    await ctx.plugin(LocalSubprocess);
    await ctx.plugin(LocalFileSystem, { cwd: dataDir });
    await ctx.plugin(Loader, { baseUrl: new URL('../package.json', import.meta.url).href });
    const id = await ctx.loader.create({ id: 'toolbox-integration', name: moduleUrl, config: { dataDir, ...config } });
    await ctx.loader.await();
    const entry = ctx.loader.resolve(id);
    if (!entry?.fiber) throw new Error('The actual Loader failed to import the toolbox module');
    await entry.fiber.await();
    return {
      ctx, id, dataDir,
      async call(name, args, signal = new AbortController().signal) {
        const batch = await ctx.tools.execute({ calls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }], signal });
        return batch.results[0].result;
      },
      async unload() { await entry.fiber.dispose(); ctx.loader.remove(id); },
      async close() { await ctx.fiber.dispose(); },
    };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}
