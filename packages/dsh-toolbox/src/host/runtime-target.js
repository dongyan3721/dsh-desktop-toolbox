/** Release targets are explicit; never discover a user's running desktop instance. */
export function runtimeTarget(runtime, platform = process.platform, architecture = process.arch) {
  const target = runtime.targets?.[`${platform}-${architecture}`];
  if (target) return { platform, architecture, ...target };
  if (platform === 'win32' && architecture === 'x64') return { platform, architecture, executable: runtime.executable, manifest: runtime.manifest };
  throw Object.assign(new Error(`No toolbox runtime is configured for ${platform}-${architecture}`), { code: 'UNSUPPORTED' });
}
