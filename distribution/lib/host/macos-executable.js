import { createHash } from 'node:crypto';
import { chmod, lstat, readFile } from 'node:fs/promises';

/** npm's Git packer normalizes non-bin files to 0644. Restore only the
 * integrity-checked bundled companion; never change an external executable. */
export async function ensureBundledMacosExecutable(path, expectedSha256) {
  const info = await lstat(path);
  if (!info.isFile() || createHash('sha256').update(await readFile(path)).digest('hex') !== expectedSha256) {
    throw Object.assign(new Error('Bundled desktop executable integrity check failed'), { code: 'NATIVE_INTEGRITY' });
  }
  if ((info.mode & 0o111) !== 0o111) await chmod(path, (info.mode & 0o777) | 0o111);
}
