$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Use-ProjectEnvironment.ps1"
$desktopBuildRoot = Split-Path $PSScriptRoot -Parent
Push-Location $desktopBuildRoot
try {
    git diff --exit-code HEAD -- native/YourAllIn1Helper
    if ($LASTEXITCODE -ne 0) { throw 'Commit native/frontend sources before creating a traceable desktop build' }
    pnpm.cmd --dir native/YourAllIn1Helper/src-ui run build
    if ($LASTEXITCODE -ne 0) { throw 'Original UI type check or production build failed' }
    cargo build --manifest-path native/YourAllIn1Helper/Cargo.toml -p all-in-one-host --bin all-in-one-desktop --release --locked --offline -j2
    if ($LASTEXITCODE -ne 0) { throw 'Desktop release build failed' }
    node scripts/bundle-desktop.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Desktop integrity bundling failed' }
    node scripts/build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Host build failed' }
} finally { Pop-Location }
# This builds local H1 inputs. It never starts a GUI, changes a user profile,
# packs over the frozen alpha.2 artifact, or claims human acceptance passed.
