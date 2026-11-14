import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat, chmod, symlink, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ensureBundledMacosExecutable } from '../packages/dsh-toolbox/src/host/macos-executable.js';

test('Git-normalized companion gets its mode back only after integrity verification', { skip: process.platform === 'win32' }, async t => {
  await mkdir(resolve('.tmp'), { recursive: true });
  const dir = await mkdtemp(resolve('.tmp/macos-mode-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'desktop');
  const bytes = Buffer.from('synthetic fixture, never executed');
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path, bytes, { mode: 0o644 });
  await assert.rejects(ensureBundledMacosExecutable(path, 'wrong'), { code: 'NATIVE_INTEGRITY' });
  assert.equal((await stat(path)).mode & 0o777, 0o644);
  await ensureBundledMacosExecutable(path, hash);
  assert.equal((await stat(path)).mode & 0o777, 0o755);
  await ensureBundledMacosExecutable(path, hash);
  await chmod(path, 0o644);
  const link = join(dir, 'link');
  await symlink(path, link);
  await assert.rejects(ensureBundledMacosExecutable(link, hash), { code: 'NATIVE_INTEGRITY' });
  assert.equal((await stat(path)).mode & 0o777, 0o644);
});
