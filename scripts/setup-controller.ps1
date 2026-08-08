# setup-controller.ps1 - Setup script specifically for Controller component
# Usage:
#   pwsh ./scripts/setup-controller.ps1 -GatewayIp 192.168.1.50 -ControllerKey <key_from_gateway>
#   pwsh ./scripts/setup-controller.ps1 -GatewayIp 192.168.1.50

param(
    [string] $GatewayIp = "auto",                                                       # Gateway Host/IP (default 'auto' detects local LAN IP)
    [string] $ControllerKey = "",                                                       # CONTROLLER_KEY from Gateway
    [switch] $NoTls,                                                                    # Set http/ws scheme instead of https/wss
    [switch] $Force                                                                     # Overwrite existing controller/.env
)

$ErrorActionPreference = "Stop"

$repo_root      = Split-Path -Parent $PSScriptRoot
$controller_dir = Join-Path $repo_root "controller"
$ws_scheme      = if ($NoTls) { "ws" } else { "wss" }
$http_scheme    = if ($NoTls) { "http" } else { "https" }

function Have-Cmd([string] $name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Get-LanIpAddress {
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

    try {
        $ip = ([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | 
            Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike "127.*" } | 
            Select-Object -ExpandProperty IPAddressToString -First 1)
        if ($ip) { return $ip }
    } catch { }

    return "127.0.0.1"
}

function Section([string] $text) {
    Write-Host ""
    Write-Host "-- $text " -ForegroundColor Cyan -NoNewline
    Write-Host ("-" * [Math]::Max(1, 60 - $text.Length)) -ForegroundColor Cyan
}

# 1. Prerequisites check
Section "Checking Controller Prerequisites"
if (-not (Have-Cmd "node") -or -not (Have-Cmd "npm")) {
    Write-Host "Node.js >= 20 and npm are required to run Controller." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js and npm found." -ForegroundColor Green

# 2. IP Resolution
if ($GatewayIp -eq "auto" -or [string]::IsNullOrWhiteSpace($GatewayIp)) {
    $GatewayIp = Get-LanIpAddress
}
Write-Host "Target Gateway IP: $GatewayIp" -ForegroundColor Yellow

# 3. Check Controller Key
if (-not $ControllerKey) {
    # Try reading from gateway/.env if it exists on the same machine
    $gw_env = Join-Path $repo_root "gateway\.env"
    if (Test-Path $gw_env) {
        $match = Get-Content $gw_env | Select-String "^CONTROLLER_KEY=(.+)$"
        if ($match) {
            $ControllerKey = $match.Matches[0].Groups[1].Value.Trim()
            Write-Host "Auto-detected CONTROLLER_KEY from local gateway/.env" -ForegroundColor Green
        }
    }
}

if (-not $ControllerKey) {
    Write-Host "[WARNING] -ControllerKey was not provided!" -ForegroundColor Yellow
    Write-Host "Please pass -ControllerKey <key_from_gateway> or edit controller/.env manually." -ForegroundColor Yellow
}

# 4. Write controller/.env
Section "Configuring Controller .env"
$cenv_path = Join-Path $controller_dir ".env"
if ((Test-Path $cenv_path) -and -not $Force) {
    Write-Host "controller/.env exists - keeping existing file (use -Force to overwrite)." -ForegroundColor DarkGray
} else {
    $cenv_body = @"
VITE_GATEWAY_URL=${ws_scheme}://${GatewayIp}:8080
VITE_CONTROLLER_KEY=$ControllerKey
VITE_USE_MOCK=false
"@
    Set-Content -Path $cenv_path -Value $cenv_body -Encoding utf8
    Write-Host "Wrote controller/.env" -ForegroundColor Green
}

# 5. Install Dependencies
Section "Installing Controller Dependencies"
Push-Location $controller_dir
if (Test-Path (Join-Path $controller_dir "package-lock.json")) { npm ci } else { npm install }
Pop-Location

# 6. Summary
Section "Controller Setup Complete"
Write-Host "Target Gateway URL : ${ws_scheme}://${GatewayIp}:8080" -ForegroundColor Yellow
Write-Host ""
Write-Host "To launch Controller UI:" -ForegroundColor Cyan
Write-Host "  cd controller; npm run dev -- --host" -ForegroundColor Gray
Write-Host "Then open browser at: ${http_scheme}://${GatewayIp}:5173 (or https://localhost:5173)" -ForegroundColor Gray
