import test from 'node:test';
// Historical headless fixtures ship a Windows x64 executable. macOS desktop
// lifecycle and module acceptance run separately against the installed Harness.
const windowsOnly = process.platform === 'win32' && process.arch === 'x64'
  ? false : 'requires the historical Windows x64 headless runtime';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import { NativeOwner } from '../packages/dsh-toolbox/src/host/native-owner.js';

const executable = fileURLToPath(new URL('../packages/dsh-toolbox/resources/win32-x64/dsh-toolbox-native.exe', import.meta.url));
export function ownerConfig(dataDir) {
  return { nativeExecutable: executable, dataDir, tempDir: fileURLToPath(new URL('../.tmp/', import.meta.url)), readRoots: [], writeRoots: [], startupTimeoutMs: 5000, requestTimeoutMs: 3000, cancelTimeoutMs: 500, shutdownTimeoutMs: 2000 };
}

test('actual Harness subprocess provider owns native bridge and releases its data lock', { skip: windowsOnly, timeout: 20000 }, async () => {
  const dataDir = fileURLToPath(new URL(`../runtime/owner-test/${randomUUID()}/`, import.meta.url));
  const ctx = new Context();
  await ctx.plugin(LocalSubprocess);
  let first;
  let second;
  try {
    first = new NativeOwner(ctx.subprocess, ownerConfig(dataDir));
    await first.start();
    assert.ok(first.capabilities.includes('notes.create'));
    const note = await first.request('notes.create', { title: 'ownership fixture', content_md: 'persistent fixture', open: false });
    assert.equal(note.is_open, false);
    await first.close();
    await first.close();
    assert.equal((await first.outcome).exit.exitCode, 0);
    second = new NativeOwner(ctx.subprocess, ownerConfig(dataDir));
    await second.start();
    const result = await second.request('notes.search', { query: 'persistent fixture', limit: 20, offset: 0 });
    assert.equal(result.items[0].id, note.id);
    await second.close();
  } finally {
    await first?.close();
    await second?.close();
    await ctx.fiber.dispose();
  }
});

test('unexpected owned process exit makes calls unavailable and allows a clean replacement', { skip: windowsOnly, timeout: 15000 }, async () => {
  const dataDir = fileURLToPath(new URL(`../runtime/owner-test/${randomUUID()}/`, import.meta.url));
  const ctx = new Context();
  await ctx.plugin(LocalSubprocess);
  const owner = new NativeOwner(ctx.subprocess, ownerConfig(dataDir));
  let replacement;
  try {
    let withdrawals = 0;
    owner.onUnavailable(() => withdrawals++);
    await owner.start();
    await owner.handle.terminate();
    await owner.outcome;
    assert.equal(owner.ready, false);
    assert.equal(withdrawals, 1);
    await assert.rejects(owner.request('status', {}), { code: 'NATIVE_UNAVAILABLE' });
    await owner.close();
    replacement = new NativeOwner(ctx.subprocess, ownerConfig(dataDir));
    await replacement.start();
    assert.ok(replacement.capabilities.includes('notes.create'));
  } finally {
    await owner.close();
    await replacement?.close();
    await ctx.fiber.dispose();
  }
});
