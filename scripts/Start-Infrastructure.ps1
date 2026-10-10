$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Run Setup-Dev.ps1 first.' }
$composeArgs = @('compose', '--project-name', 'autoinsight', '--env-file', $envFile, '--file', (Join-Path $projectRoot 'infra\compose.yaml'))
& docker @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose configuration failed validation.' }
$runningServices = @(& docker @composeArgs ps --status running --services)
foreach ($entry in @(@{ Key='POSTGRES_PORT'; Default=5433; Service='postgres' }, @{ Key='REDIS_PORT'; Default=6380; Service='redis' })) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$($entry.Key)=" } | Select-Object -First 1
    $port = if ($line) { [int]($line.Split('=', 2)[1]) } else { $entry.Default }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($listener -and $entry.Service -notin $runningServices) { throw "Port $port is occupied by another service. No service was stopped." }
}
& docker @composeArgs up --build --detach --wait --wait-timeout 120
if ($LASTEXITCODE -ne 0) { throw 'AutoInsight infrastructure did not become healthy. Inspect its service logs.' }
