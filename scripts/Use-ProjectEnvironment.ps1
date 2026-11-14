# Dot-source before Windows builds/tests. All writable task state stays local.
$taskProjectRoot = Split-Path $PSScriptRoot -Parent
$taskDirectories = @('.tmp','build/rust/target','build/rust/intermediates','dist','artifacts','runtime/dsh-dev')
foreach ($taskDirectory in $taskDirectories) {
    New-Item -ItemType Directory -Force -Path (Join-Path $taskProjectRoot $taskDirectory) | Out-Null
}
$env:TEMP = Join-Path $taskProjectRoot '.tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:NODE_COMPILE_CACHE = Join-Path $env:TEMP 'node-compile-cache'
$env:CARGO_HOME = Join-Path $env:TEMP 'cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $taskProjectRoot 'build/rust/target'
$env:CARGO_BUILD_BUILD_DIR = Join-Path $taskProjectRoot 'build/rust/intermediates'
$env:NPM_CONFIG_CACHE = Join-Path $env:TEMP 'npm-cache'
$env:PNPM_HOME = Join-Path $env:TEMP 'pnpm-home'
$env:DSH_HOME = Join-Path $taskProjectRoot 'runtime/dsh-dev'
$env:DSH_TOOLBOX_WORKSPACE = $taskProjectRoot
# Existing toolchains/installations are read-only inputs, not writable caches.
if (Test-Path 'D:\Dev\Rust\cargo\bin') { $env:Path = "D:\Dev\Rust\cargo\bin;$env:Path" }
if (Test-Path 'D:\Dev\Rust\rustup') { $env:RUSTUP_HOME = 'D:\Dev\Rust\rustup' }
if ($env:DSH_HARNESS_APP_DIR -and (Test-Path "$env:DSH_HARNESS_APP_DIR/resources/runtime/cli/bin")) {
    $env:Path = "$env:DSH_HARNESS_APP_DIR/resources/runtime/cli/bin;$env:Path"
} elseif (Test-Path 'E:\deepseek-harness\resources\runtime\cli\bin') {
    $env:Path = "E:\deepseek-harness\resources\runtime\cli\bin;$env:Path"
}
Remove-Variable taskDirectories,taskDirectory,taskProjectRoot
