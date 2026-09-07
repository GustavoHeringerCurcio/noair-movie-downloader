<#
.SYNOPSIS
  noAir dev workflow: runs infra + live-reloading app containers.
.EXAMPLE
  .\scripts\dev.ps1            # up    — build dev images (cached) and start
  .\scripts\dev.ps1 up         #       — same as above
  .\scripts\dev.ps1 start      #       — start without rebuilding images
  .\scripts\dev.ps1 rebuild    #       — rebuild dev images after adding an npm dep
  .\scripts\dev.ps1 down       #       — stop the whole stack
  .\scripts\dev.ps1 logs       #       — tail logs
  .\scripts\dev.ps1 ps         #       — container status
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('up', 'start', 'rebuild', 'down', 'logs', 'ps')]
  [string]$Action = 'up'
)

$ErrorActionPreference = 'Stop'
$compose = @('-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml')

switch ($Action) {
  'up' {
    Write-Host 'Starting dev stack (builds dev images, cached on repeat)...' -ForegroundColor Cyan
    & docker compose @compose up -d --build
  }
  'start' {
    Write-Host 'Starting dev stack (no rebuild)...' -ForegroundColor Cyan
    & docker compose @compose up -d
  }
  'rebuild' {
    Write-Host 'Rebuilding dev images (do this after adding an npm dependency)...' -ForegroundColor Cyan
    & docker compose @compose build --no-cache backend frontend
    & docker compose @compose up -d
  }
  'down' {
    & docker compose @compose down
  }
  'logs' {
    & docker compose @compose logs -f --tail=100 backend frontend
  }
  'ps' {
    & docker compose @compose ps
  }
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
