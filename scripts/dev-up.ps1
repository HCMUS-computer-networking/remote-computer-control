# dev-up.ps1 — launch Gateway (background) + Controller (foreground) in parallel.
# Run from repo root: pwsh ./scripts/dev-up.ps1
#
# Gateway starts as a PowerShell background job (stdout/stderr streamed to logs/).
# Controller runs in the current console so Ctrl+C stops it cleanly. On exit, the
# Gateway job is stopped too.

$ErrorActionPreference = "Stop"

$repo_root       = Split-Path -Parent $PSScriptRoot
$gateway_dir     = Join-Path $repo_root "gateway"
$controller_dir  = Join-Path $repo_root "controller"
$log_dir         = Join-Path $repo_root "logs"

New-Item -ItemType Directory -Force -Path $log_dir | Out-Null

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Remote Computer Control — dev-up"          -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Gateway    → http://localhost:8080"          -ForegroundColor Yellow
Write-Host "  Controller → http://localhost:5173"          -ForegroundColor Yellow
Write-Host "  Health     → http://localhost:8080/health"   -ForegroundColor Yellow
Write-Host "  Gateway log: $log_dir\gateway-dev.log"       -ForegroundColor DarkGray
Write-Host ""

# Ensure dependencies are installed (idempotent, skips if node_modules exists).
if (-not (Test-Path (Join-Path $gateway_dir "node_modules")))
{
    Write-Host "[dev-up] Installing gateway dependencies..." -ForegroundColor Green
    Push-Location $gateway_dir; npm install; Pop-Location
}
if (-not (Test-Path (Join-Path $controller_dir "node_modules")))
{
    Write-Host "[dev-up] Installing controller dependencies..." -ForegroundColor Green
    Push-Location $controller_dir; npm install; Pop-Location
}

# Launch gateway as background job. Redirects both streams to a rolling log.
Write-Host "[dev-up] Starting Gateway (background)..." -ForegroundColor Green
$gateway_job = Start-Job -Name "gateway-dev" -ScriptBlock {
    param($dir, $log)
    Set-Location $dir
    npm run dev *>&1 | Tee-Object -FilePath $log
} -ArgumentList $gateway_dir, (Join-Path $log_dir "gateway-dev.log")

# Give the gateway a moment to bind :8080 before controller opens its browser.
Start-Sleep -Seconds 2

try
{
    Write-Host "[dev-up] Starting Controller (foreground, Ctrl+C to stop both)..." -ForegroundColor Green
    Push-Location $controller_dir
    npm run dev
    Pop-Location
}
finally
{
    Write-Host ""
    Write-Host "[dev-up] Stopping Gateway job..." -ForegroundColor Yellow
    Stop-Job   -Job $gateway_job -ErrorAction SilentlyContinue
    Remove-Job -Job $gateway_job -ErrorAction SilentlyContinue
    Write-Host "[dev-up] Done."                    -ForegroundColor Yellow
}
