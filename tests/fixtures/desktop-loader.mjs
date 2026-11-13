import { fileURLToPath } from 'node:url';
import { Config, ToolboxDesktopService, DESKTOP_RUNTIME } from '../../packages/dsh-toolbox/lib/desktop/index.js';
import { NativeOwner } from '../../packages/dsh-toolbox/lib/host/native-owner.js';
export { Config };
export const name = 'desktop-service-protocol-fixture';
export const inject = ['subprocess'];
export async function apply(ctx, config) {
  const runtime = { ...DESKTOP_RUNTIME, flags: [fileURLToPath(new URL('./desktop-control-child.mjs', import.meta.url)), '--toolbox-plugin'] };
  const service = new ToolboxDesktopService(ctx, config);
  service.createOwner = () => new NativeOwner(ctx.subprocess, service.config, runtime);
  await service.start();
}
