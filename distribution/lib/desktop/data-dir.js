import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { hostError } from '../host/native-owner.js';

/** Match Harness home defaults even when its launcher leaves DSH_HOME unset. */
export function resolveDesktopDataDir(configured, env = process.env, home = homedir()) {
  const explicit = configured || env.DSH_TOOLBOX_DATA_DIR;
  if (explicit) {
    if (typeof explicit !== 'string' || !isAbsolute(explicit)) {
      throw hostError('INVALID_CONFIG', 'Desktop dataDir must be absolute');
    }
    return explicit;
  }
  let harnessHome = env.DSH_HOME || join(home, '.dsh');
  if (harnessHome === '~') harnessHome = home;
  else if (/^~[/\\]/.test(harnessHome)) harnessHome = join(home, harnessHome.slice(2));
  return join(resolve(harnessHome), 'toolbox-desktop-data');
}
