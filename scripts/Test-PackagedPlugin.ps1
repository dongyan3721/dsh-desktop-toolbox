param(
    [Parameter(Mandatory=$true)][string]$Package,
    [string]$Dsh = 'E:/deepseek-harness/resources/runtime/cli/bin/dsh.cmd',
    [string]$PreviousPackage = ''
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Use-ProjectEnvironment.ps1"
$acceptanceRoot = Split-Path $PSScriptRoot -Parent
$packagePath = (Resolve-Path -LiteralPath $Package).Path
$runId = [guid]::NewGuid().ToString()
$env:DSH_HOME = Join-Path $acceptanceRoot "runtime/package-acceptance/$runId"
$env:DSH_TELEMETRY_DISABLED = '1'
$env:DSH_TOOLBOX_ACCEPTANCE_TOKEN = "acceptance-$runId"
$env:DSH_TOOLBOX_ACCEPTANCE_PHASE = 'create'
$profileName = 'toolbox-acceptance'
$artifactDir = Join-Path $acceptanceRoot "artifacts/package-acceptance/$runId"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$driverPatch = Join-Path $artifactDir 'driver.patch.json'
$rows = @(@{ insert = @(@{ id = 'toolbox-acceptance-driver'; name = (Join-Path $PSScriptRoot 'profile-smoke.mjs') }) })
ConvertTo-Json -InputObject $rows -Depth 6 | Set-Content -LiteralPath $driverPatch

function Invoke-AcceptanceDsh([string]$LogName, [string[]]$DshArguments) {
    if ($LogName.EndsWith('.yml')) {
        & $Dsh @DshArguments 2>&1 | Set-Content -LiteralPath (Join-Path $artifactDir $LogName)
    } else {
        & $Dsh @DshArguments 2>&1 | Tee-Object -FilePath (Join-Path $artifactDir $LogName)
    }
    if ($LASTEXITCODE -ne 0) { throw "dsh failed ($LASTEXITCODE); see $artifactDir/$LogName" }
}
$firstPackage = if ($PreviousPackage) { (Resolve-Path -LiteralPath $PreviousPackage).Path } else { $packagePath }
Invoke-AcceptanceDsh 'install.log' @('plugin','--profile',$profileName,'add',$firstPackage)
Invoke-AcceptanceDsh 'config.yml' @('--profile',$profileName,'--dump-config')
if (!(Select-String -LiteralPath (Join-Path $artifactDir 'config.yml') -Pattern 'id: toolbox-native' -Quiet)) { throw 'Installed Bundle entry is missing' }
Invoke-AcceptanceDsh 'create.log' @('--profile',$profileName,'--patch',$driverPatch)
if (!(Select-String -LiteralPath (Join-Path $artifactDir 'create.log') -Pattern 'TOOLBOX_ACCEPTANCE ' -Quiet)) { throw 'Profile did not execute the acceptance driver' }
$env:DSH_TOOLBOX_ACCEPTANCE_PHASE = 'restart'
Invoke-AcceptanceDsh 'restart.log' @('--profile',$profileName,'--patch',$driverPatch)
if (!(Select-String -LiteralPath (Join-Path $artifactDir 'restart.log') -Pattern 'persistedAcrossProfileRestart' -Quiet)) { throw 'Profile persistence check failed' }
if ($PreviousPackage) {
    Invoke-AcceptanceDsh 'upgrade.log' @('plugin','--profile',$profileName,'add',$packagePath)
    Invoke-AcceptanceDsh 'upgraded-restart.log' @('--profile',$profileName,'--patch',$driverPatch)
    if (!(Select-String -LiteralPath (Join-Path $artifactDir 'upgraded-restart.log') -Pattern 'persistedAcrossProfileRestart' -Quiet)) { throw 'Upgrade persistence check failed' }
}
Invoke-AcceptanceDsh 'remove.log' @('plugin','--profile',$profileName,'remove','dsh-toolbox')
Invoke-AcceptanceDsh 'removed-config.yml' @('--profile',$profileName,'--dump-config')
if (Select-String -LiteralPath (Join-Path $artifactDir 'removed-config.yml') -Pattern 'id: toolbox-native' -Quiet) { throw 'Removed Bundle entry remains in configuration' }
if (!(Test-Path -LiteralPath (Join-Path $env:DSH_HOME 'toolbox-data/app.db'))) { throw 'Package removal unexpectedly removed persistent data' }
Write-Output "Packaged Profile acceptance passed. Generated fixtures and logs: $artifactDir"
