import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import { authorizeImagePaths } from '../packages/dsh-toolbox/src/host/image-policy.js';

async function fixture(mode) {
  const root = fileURLToPath(new URL(`../runtime/policy-tests/${randomUUID()}/`, import.meta.url));
  const read = join(root, 'read'); const write = join(root, 'write'); const outside = join(root, 'outside');
  await Promise.all([read, write, outside].map(path => mkdir(path, { recursive: true })));
  await writeFile(join(read, 'source.png'), Buffer.from([1, 2, 3]));
  const ctx = new Context();
  if (mode) {
    await ctx.plugin(SessionProjections);
    await ctx.plugin(SandboxPolicy, { mode, workspaceRoot: write });
    await ctx.plugin(SandboxedFileSystem, { cwd: root });
  } else await ctx.plugin(LocalFileSystem, { cwd: root });
  const config = { readRoots: [read], writeRoots: [write], maxImageBytes: 100 };
  const signal = new AbortController().signal;
  const request = { inputPath: join(read, 'source.png'), outputPath: join(write, 'output.webp'), format: 'webp', signal };
  return { root, read, write, outside, ctx, config, request, exec: { signal } };
}

test('actual host filesystem authorization enforces roots, absent output and intent policy', async () => {
  const f = await fixture();
  try {
    assert.equal(await authorizeImagePaths(f.ctx, f.config, f.request, f.exec), true);
    await assert.rejects(authorizeImagePaths(f.ctx, f.config, { ...f.request, outputPath: join(f.outside, 'out.webp') }, f.exec), { code: 'ACCESS_DENIED' });
    await writeFile(f.request.outputPath, 'preserve');
    await assert.rejects(authorizeImagePaths(f.ctx, f.config, f.request, f.exec), { code: 'CONFLICT' });
    f.ctx.on('fs/write-intent', () => { throw Object.assign(new Error('fixture policy denied'), { code: 'FS_NOT_OBSERVED' }); });
    await assert.rejects(authorizeImagePaths(f.ctx, f.config, { ...f.request, outputPath: join(f.write, 'other.webp') }, f.exec), { code: 'FS_NOT_OBSERVED' });
  } finally { await f.ctx.fiber.dispose(); }
});

test('resolved junction output cannot escape the configured write root', async () => {
  const f = await fixture();
  try {
    await symlink(f.outside, join(f.write, 'alias'), 'junction');
    await assert.rejects(authorizeImagePaths(f.ctx, f.config, { ...f.request, outputPath: join(f.write, 'alias', 'out.webp') }, f.exec), { code: 'ACCESS_DENIED' });
  } finally { await f.ctx.fiber.dispose(); }
});

test('actual read-only sandbox policy denies native image output', async () => {
  const f = await fixture('read-only');
  try { await assert.rejects(authorizeImagePaths(f.ctx, f.config, f.request, f.exec), { code: 'FS_SANDBOX_DENIED' }); }
  finally { await f.ctx.fiber.dispose(); }
});

test('actual workspace-write sandbox authorizes the configured workspace root', async () => {
  const f = await fixture('workspace-write');
  try { assert.equal(await authorizeImagePaths(f.ctx, f.config, f.request, f.exec), true); }
  finally { await f.ctx.fiber.dispose(); }
});
