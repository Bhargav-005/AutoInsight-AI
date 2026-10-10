$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & uv sync --locked --project backend --cache-dir (Join-Path $projectRoot '.cache\uv')
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    Push-Location (Join-Path $projectRoot 'backend')
    try {
        & .\.venv\Scripts\python.exe -m app.bootstrap
        if ($LASTEXITCODE -ne 0) { throw 'Local configuration setup failed.' }
    } finally { Pop-Location }
    Push-Location (Join-Path $projectRoot 'frontend')
    try {
        & npm.cmd ci --cache (Join-Path $projectRoot '.cache\npm')
        if ($LASTEXITCODE -ne 0) { throw 'Node dependency installation failed.' }
    } finally { Pop-Location }
} finally { Pop-Location }
