$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend\node_modules'))) {
    throw 'Run scripts\Setup-Dev.ps1 first.'
}
Push-Location (Join-Path $projectRoot 'frontend')
try {
    & npm.cmd run dev
    if ($LASTEXITCODE -ne 0) { throw 'Frontend exited with an error. Check configuration and port availability.' }
} finally { Pop-Location }
