$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Use-ProjectEnvironment.ps1"
$previewWorkspace = Split-Path $PSScriptRoot -Parent
$previewManifest = Join-Path $previewWorkspace 'runtime/human-preview.json'
if (!(Test-Path -LiteralPath $previewManifest)) {
    throw 'This workspace has no installed human preview. See docs/INTEGRATION_H1.zh-CN.md.'
}
$preview = Get-Content -LiteralPath $previewManifest -Raw | ConvertFrom-Json
foreach ($previewDirectory in @($preview.home, $preview.data, $preview.electron)) {
    if (![System.IO.Path]::IsPathRooted($previewDirectory) -or !(Test-Path -LiteralPath $previewDirectory -PathType Container)) {
        throw 'The recorded isolated preview directory is missing or is not absolute.'
    }
}
$env:DSH_HOME = $preview.home
$env:DSH_TOOLBOX_DATA_DIR = $preview.data
$env:DSH_TELEMETRY_DISABLED = '1'
Start-Process -FilePath $preview.app -ArgumentList @("--user-data-dir=`"$($preview.electron)`"") -WindowStyle Normal
