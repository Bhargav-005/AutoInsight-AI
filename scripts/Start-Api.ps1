$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run scripts\Setup-Dev.ps1 first.' }
Push-Location (Join-Path $projectRoot 'backend')
try {
    & $pythonPath -m app
    if ($LASTEXITCODE -ne 0) { throw 'API exited with an error. Check configuration and port availability.' }
} finally { Pop-Location }
