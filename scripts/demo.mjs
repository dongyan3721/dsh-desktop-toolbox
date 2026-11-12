import { createPrototypeContext } from './prototype-context.mjs';
const { ctx, id } = await createPrototypeContext();
try {
  const tool = ctx.tools.definitions().find(tool => tool.name === 'toolbox_status');
  if (!tool) throw new Error('Loader did not register toolbox_status');
  const batch = await ctx.tools.execute({ calls: [{ id: 'prototype-status', name: 'toolbox_status', arguments: '{}' }], signal: new AbortController().signal });
  console.log(JSON.stringify({ loaderEntry: id, batch }, null, 2));
} finally {
  await ctx.loader.remove(id);
  await ctx.fiber.dispose();
}
