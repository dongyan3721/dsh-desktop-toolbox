# Dot-source before building, testing or packaging this project.
$taskProjectRoot = Split-Path $PSScriptRoot -Parent
$taskDirectories = @('.tmp','build/rust/target','build/rust/intermediates','dist','artifacts','runtime/dsh-dev')
foreach ($taskDirectory in $taskDirectories) {
    New-Item -ItemType Directory -Force -Path (Join-Path $taskProjectRoot $taskDirectory) | Out-Null
}
$env:TEMP = Join-Path $taskProjectRoot '.tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:NODE_COMPILE_CACHE = Join-Path $env:TEMP 'node-compile-cache'
$env:CARGO_HOME = 'D:\Dev\Rust\cargo'
$env:RUSTUP_HOME = 'D:\Dev\Rust\rustup'
$env:CARGO_TARGET_DIR = Join-Path $taskProjectRoot 'build/rust/target'
$env:CARGO_BUILD_BUILD_DIR = Join-Path $taskProjectRoot 'build/rust/intermediates'
$env:NPM_CONFIG_CACHE = 'D:\cache\Node\npm-cache'
$env:PNPM_HOME = 'D:\cache\Node\pnpm'
$env:DSH_HOME = Join-Path $taskProjectRoot 'runtime/dsh-dev'
$env:DSH_TOOLBOX_WORKSPACE = $taskProjectRoot
$env:Path = "$env:CARGO_HOME\bin;D:\cache\Node\npm-global;E:\deepseek-harness\resources\runtime\cli\bin;$env:Path"
Remove-Variable taskDirectories,taskDirectory,taskProjectRoot
