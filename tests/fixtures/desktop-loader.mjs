import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Config, ToolboxDesktopService, DESKTOP_RUNTIME } from '../../packages/dsh-toolbox/lib/desktop/index.js';
import { NativeOwner } from '../../packages/dsh-toolbox/lib/host/native-owner.js';
export { Config };
export const name = 'desktop-service-protocol-fixture';
export const inject = ['subprocess'];
export async function apply(ctx, config) {
  const ownerConfig = { ...config, tempDir: join(config.dataDir, '.tmp'), readRoots: [], writeRoots: [] };
  const runtime = { ...DESKTOP_RUNTIME, flags: [fileURLToPath(new URL('./desktop-control-child.mjs', import.meta.url)), '--toolbox-plugin'] };
  const service = new ToolboxDesktopService(ctx, config, () => new NativeOwner(ctx.subprocess, ownerConfig, runtime));
  await service.start();
}
