$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Use-ProjectEnvironment.ps1"
$buildRoot = Split-Path $PSScriptRoot -Parent
Push-Location $buildRoot
try {
    $releaseVersion = (Get-Content packages/dsh-toolbox/package.json -Raw | ConvertFrom-Json).version
    foreach ($releaseName in @('dsh-toolbox', 'dsh-toolbox-client', 'dsh-toolbox-bundle')) {
        if (Test-Path -LiteralPath (Join-Path $buildRoot "dist/$releaseName-$releaseVersion.tgz")) {
            throw "Release archive already exists: $releaseName-$releaseVersion.tgz. Use a new version instead of replacing an artifact."
        }
    }
    pnpm.cmd --dir packages/dsh-toolbox-client run build:client
    if ($LASTEXITCODE -ne 0) { throw 'Embedded console build failed' }
    & "$PSScriptRoot/Build-Desktop.ps1"
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
    Push-Location packages/dsh-toolbox-client
    try {
        pnpm.cmd pack --pack-destination ../../dist
        if ($LASTEXITCODE -ne 0) { throw 'Client package creation failed' }
    } finally { Pop-Location }
    node scripts/bundle-github.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Complete GitHub Bundle assembly failed' }
    pnpm.cmd pack --pack-destination dist
    if ($LASTEXITCODE -ne 0) { throw 'Complete Bundle package creation failed' }
} finally { Pop-Location }
