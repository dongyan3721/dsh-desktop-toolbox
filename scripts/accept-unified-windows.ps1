# Install the same public bundle URL using the unmodified official Harness CLI.
param([Parameter(Mandatory=$true)][string]$BundleRef)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Use-ProjectEnvironment.ps1"
$taskRoot = $env:DSH_TOOLBOX_WORKSPACE
$env:DSH_HOME = Join-Path $taskRoot '.tmp/b8h'
New-Item -ItemType Directory -Force $env:DSH_HOME | Out-Null
'{"name":"toolbox-isolated-home","private":true,"type":"module"}' | Set-Content (Join-Path $env:DSH_HOME 'package.json') -Encoding utf8
$dsh = Join-Path $env:DSH_HARNESS_APP_DIR 'resources/runtime/cli/bin/dsh.cmd'
if (-not (Test-Path $dsh)) { throw 'Official CLI missing' }
& $dsh --profile beta8 --from-default-profile web --dump-config > "$taskRoot/artifacts/beta8-windows-config.yml"
if ($LASTEXITCODE -ne 0) { throw 'Fresh profile failed' }
& $dsh plugin --profile beta8 add $BundleRef --store-dir "$taskRoot/.tmp/b8-store" > "$taskRoot/artifacts/beta8-windows-install.log" 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Public bundle installation failed' }
$profile = Join-Path $env:DSH_HOME 'profiles/beta8'
node "$taskRoot/scripts/prepare-unified-acceptance.mjs" windows-installed $profile
if ($LASTEXITCODE -ne 0) { throw 'Acceptance setup failed' }
Push-Location $profile
try {
    foreach ($phase in @('default','enabled','persisted')) {
        if ($phase -eq 'enabled') {
            node "$taskRoot/scripts/prepare-unified-acceptance.mjs" windows-installed $profile usage-fixture
            if ($LASTEXITCODE -ne 0) { throw 'Usage fixture failed' }
        }
        $env:TOOLBOX_ACCEPTANCE_PHASE = $phase
        $log = "$taskRoot/artifacts/beta8-windows-$phase.log"
        & $dsh --profile beta8 --patch "$profile/acceptance.patch.yml" --host 127.0.0.1 --port 0 --no-open > $log 2>&1
        $result = $LASTEXITCODE
        $text = [IO.File]::ReadAllText($log) -replace '(http://127\.0\.0\.1:\d+/\?token=)\S+', '$1[redacted]'
        [IO.File]::WriteAllText($log, $text)
        $text -split "`n" | Where-Object { $_ -match '^BETA8_' } | Write-Output
        if ($result -ne 0) { throw "Installed Windows acceptance failed: $phase" }
    }
    $remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'all-in-one-desktop.exe' -and $_.ExecutablePath -like "$profile*" })
    if ($remaining.Count -ne 0) { throw 'Owned desktop process survived shutdown' }
    Write-Output 'BETA8_WINDOWS_INSTALLED_AND_CLEANED'
} finally { Pop-Location }
