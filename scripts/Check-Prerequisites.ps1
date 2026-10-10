$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
foreach ($command in @('python', 'uv', 'node', 'npm.cmd', 'git', 'docker')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Missing prerequisite: $command" }
}
& python --version
& uv --version
& node --version
& npm.cmd --version
& docker compose version
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose unavailable.' }
& docker info --format 'Docker root: {{.DockerRootDir}}'
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop with its Linux engine.' }
Get-PSDrive C,E | Select-Object Name,Free,Used
Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\Docker\wsl" -Recurse -Filter '*.vhdx' -ErrorAction SilentlyContinue |
    Select-Object FullName,Length
Write-Output "Project root: $projectRoot"
Write-Output 'Check host drive capacity for the displayed Docker disk before growing images or volumes.'
