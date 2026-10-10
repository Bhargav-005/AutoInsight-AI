$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& docker compose --project-name autoinsight --env-file (Join-Path $projectRoot '.env') --file (Join-Path $projectRoot 'infra\compose.yaml') stop
if ($LASTEXITCODE -ne 0) { throw 'AutoInsight stop command failed.' }
Write-Output 'AutoInsight containers stopped; named volumes and artifacts preserved. Stop foreground API/frontend terminals with Ctrl+C.'
