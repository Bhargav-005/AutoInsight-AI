param([switch]$Integration, [switch]$Browser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $projectRoot 'backend')
try {
    & .\.venv\Scripts\ruff.exe check .
    if ($LASTEXITCODE -ne 0) { throw 'Backend lint failed.' }
    & .\.venv\Scripts\ruff.exe format --check .
    if ($LASTEXITCODE -ne 0) { throw 'Backend format check failed.' }
    & .\.venv\Scripts\python.exe -m pytest
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
    if ($Integration) {
        & .\.venv\Scripts\python.exe -m pytest -m integration
        if ($LASTEXITCODE -ne 0) { throw 'Infrastructure integration tests failed.' }
    }
} finally { Pop-Location }
Push-Location (Join-Path $projectRoot 'frontend')
try {
    foreach ($task in @('lint', 'typecheck', 'test', 'build')) {
        & npm.cmd run $task
        if ($LASTEXITCODE -ne 0) { throw "Frontend $task failed." }
    }
    if ($Browser) {
        & npm.cmd run test:e2e
        if ($LASTEXITCODE -ne 0) { throw 'Browser tests failed.' }
    }
} finally { Pop-Location }
