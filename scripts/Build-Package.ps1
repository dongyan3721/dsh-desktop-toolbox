$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Use-ProjectEnvironment.ps1"
$buildRoot = Split-Path $PSScriptRoot -Parent
Push-Location $buildRoot
try {
    cargo build --manifest-path native/YourAllIn1Helper/Cargo.toml -p dsh-bridge --release --locked --offline
    if ($LASTEXITCODE -ne 0) { throw 'Native release build failed' }
    node scripts/bundle-native.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Native release bundling failed' }
    node scripts/build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Host build failed' }
    Push-Location packages/dsh-toolbox
    try {
        pnpm.cmd pack --pack-destination ../../dist
        if ($LASTEXITCODE -ne 0) { throw 'Package creation failed' }
    } finally { Pop-Location }
} finally { Pop-Location }
