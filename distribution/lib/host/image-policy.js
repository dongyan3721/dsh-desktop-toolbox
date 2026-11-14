import { isAbsolute, resolve } from 'node:path';
import { writableRoots } from '@deepseek-ai/dsh-sandbox';
import { hostError } from './native-owner.js';

async function underAny(fs, target, roots, signal) {
  for (const root of roots) {
    const parent = await fs.resolve(root, { signal });
    if (await fs.contains(parent, target)) return true;
  }
  return false;
}

/** Authorize through the mounted execution-world filesystem and its standing policy. */
export async function authorizeImagePaths(ctx, config, request, exec) {
  const { inputPath, outputPath, signal } = request;
  signal.throwIfAborted();
  const fs = ctx.get('fs');
  if (!fs || !isAbsolute(inputPath) || !isAbsolute(outputPath)) throw hostError('ACCESS_DENIED', 'Images require a host-backed filesystem and absolute paths');
  for (const path of [inputPath, outputPath]) {
    const mapped = fs.processPathFromHostPath(path);
    if (!mapped || resolve(mapped).toLowerCase() !== resolve(path).toLowerCase()) throw hostError('ACCESS_DENIED', 'The mounted filesystem does not share the native execution world');
  }
  const input = await fs.resolve(inputPath, { signal });
  const output = await fs.resolve(outputPath, { signal });
  if (!await underAny(fs, input, config.readRoots, signal) || !await underAny(fs, output, config.writeRoots, signal)) throw hostError('ACCESS_DENIED', 'The image paths are outside the configured native roots');
  const policyService = ctx.get('sandboxPolicy');
  if (fs.sandboxMode !== undefined && !policyService) throw hostError('ACCESS_DENIED', 'A confining filesystem requires its standing sandbox policy');
  const policy = policyService?.resolve(exec.agent ? { session: exec.agent.session } : {});
  if (policy && policy.mode !== 'danger-full-access') {
    if (policy.mode !== 'workspace-write' || !await underAny(fs, output, writableRoots(policy), signal)) throw hostError('FS_SANDBOX_DENIED', 'The active filesystem policy denies this image output');
  }
  const info = await fs.stat(input, signal);
  if (!info || info.type !== 'file') throw hostError('NOT_FOUND', 'Image input must be an existing regular file');
  if (info.size > config.maxImageBytes) throw hostError('INVALID_REQUEST', 'Image input exceeds maxImageBytes');
  if (await fs.stat(output, signal)) throw hostError('CONFLICT', 'Image output already exists');
  // Consult any mounted observation/intent policy before the out-of-process mutation.
  await ctx.waterfall('fs/write-intent', output, exec, () => undefined);
  signal.throwIfAborted();
  return true;
}
