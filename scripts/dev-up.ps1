# dev-up.ps1 — launch Gateway (background) + Controller (foreground) in parallel for LAN / dev.
# Run from repo root: pwsh ./scripts/dev-up.ps1

$ErrorActionPreference = "Stop"

$repo_root       = Split-Path -Parent $PSScriptRoot
$gateway_dir     = Join-Path $repo_root "gateway"
$controller_dir  = Join-Path $repo_root "controller"
$log_dir         = Join-Path $repo_root "logs"

New-Item -ItemType Directory -Force -Path $log_dir | Out-Null

function Get-LanIpAddress
{
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { 
            $_.IPAddress -notlike "127.*" -and 
            $_.IPAddress -notlike "169.254.*" -and 
            $_.InterfaceAlias -notlike "*Loopback*" -and 
            $_.InterfaceAlias -notlike "*vEthernet*" -and 
            $_.InterfaceAlias -notlike "*WSL*" -and 
            $_.InterfaceAlias -notlike "*Virtual*"
        } | Select-Object -ExpandProperty IPAddress -First 1)
        if ($ip) { return $ip }
    } catch { }
    return "localhost"
}

$lan_ip = Get-LanIpAddress

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Remote Computer Control — dev-up (LAN)"    -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ("  Gateway    → https://{0}:8080" -f $lan_ip)     -ForegroundColor Yellow
Write-Host ("  Controller → https://{0}:5173" -f $lan_ip)     -ForegroundColor Yellow
Write-Host ("  Health     → https://{0}:8080/health" -f $lan_ip) -ForegroundColor Yellow
Write-Host ("  Gateway log: {0}\gateway-dev.log" -f $log_dir)  -ForegroundColor DarkGray
Write-Host ""

# Ensure dependencies are installed
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

# Launch gateway as background job
Write-Host "[dev-up] Starting Gateway (background)..." -ForegroundColor Green
$gateway_job = Start-Job -Name "gateway-dev" -ScriptBlock {
    param($dir, $log)
    Set-Location $dir
    npm run dev *>&1 | Tee-Object -FilePath $log
} -ArgumentList $gateway_dir, (Join-Path $log_dir "gateway-dev.log")

Start-Sleep -Seconds 2

try
{
    Write-Host "[dev-up] Starting Controller (foreground on 0.0.0.0, Ctrl+C to stop both)..." -ForegroundColor Green
    Push-Location $controller_dir
    npm run dev -- --host
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
