$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $projectRoot 'backend')
try {
    & .\.venv\Scripts\python.exe -m app.bootstrap
    if ($LASTEXITCODE -ne 0) { throw 'Security configuration setup failed.' }
    & .\.venv\Scripts\python.exe -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw 'Migration upgrade failed.' }
    & .\.venv\Scripts\python.exe -m app.bootstrap --database-role
    if ($LASTEXITCODE -ne 0) { throw 'Application database role setup failed.' }
} finally { Pop-Location }
