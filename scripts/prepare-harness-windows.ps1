# Extract the official application read-only; do not run its installer.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Use-ProjectEnvironment.ps1"
$taskRoot = $env:DSH_TOOLBOX_WORKSPACE
$installer = Join-Path $taskRoot '.tmp/deepseek-harness-0.2.2-rc.3-win-x64.exe'
Invoke-WebRequest 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.3-win-x64.exe' -OutFile $installer
$hash = [Convert]::ToBase64String([Security.Cryptography.SHA512]::HashData([IO.File]::ReadAllBytes($installer)))
if ($hash -ne 'GiJf8kx+C7eoiZ0xQSYBcTyh5xmXQl+vh63U6uSm963McK1AkMgB8PydzuekWdUY7hyURvhVMHANM4pn+tCKzQ==') { throw 'Official Harness checksum mismatch' }
& 7z x $installer "-o$taskRoot/build/harness-installer" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Installer extraction failed' }
$payload = Get-ChildItem "$taskRoot/build/harness-installer" -Recurse -Filter app-64.7z | Select-Object -First 1
if (-not $payload) { throw 'Official app payload not found' }
& 7z x $payload.FullName "-o$taskRoot/build/harness-windows" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'App extraction failed' }
$env:DSH_HARNESS_APP_DIR = "$taskRoot/build/harness-windows"
if ($env:GITHUB_ENV) { "DSH_HARNESS_APP_DIR=$env:DSH_HARNESS_APP_DIR" >> $env:GITHUB_ENV }
$app = Get-ChildItem $env:DSH_HARNESS_APP_DIR -Filter '*.exe' | Where-Object { $_.Name -notmatch 'Uninstall' } | Select-Object -First 1
if (-not $app) { throw 'Harness Electron executable missing' }
$oldElectronMode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & $app.FullName "$taskRoot/scripts/prepare-installed-sdk.cjs"
    if ($LASTEXITCODE -ne 0) { throw 'SDK extraction failed' }
} finally { $env:ELECTRON_RUN_AS_NODE = $oldElectronMode }
