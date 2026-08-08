# setup-gateway.ps1 - Setup script specifically for Gateway component
# Usage:
#   pwsh ./scripts/setup-gateway.ps1
#   pwsh ./scripts/setup-gateway.ps1 -GatewayIp 192.168.1.50 -E2eePin "my-custom-pin"

param(
    [string] $GatewayIp = "auto",                                                       # Host/IP (default 'auto' detects LAN IP)
    [string] $AdminPassword = "admin123",                                              # Seeded Controller login password
    [string] $AgentKey = "",                                                            # Agent shared secret (generated if empty)
    [string] $ControllerKey = "",                                                       # Controller shared secret (generated if empty)
    [string] $JwtSecret = "",                                                           # JWT secret (generated if empty)
    [string] $E2eePin = "default-pin-12345",                                            # E2EE PIN
    [switch] $NoTls,                                                                    # Set TLS_ENABLED=false (http/ws)
    [switch] $Force                                                                     # Overwrite existing .env / cert
)

$ErrorActionPreference = "Stop"

$repo_root   = Split-Path -Parent $PSScriptRoot
$gateway_dir = Join-Path $repo_root "gateway"
$scheme      = if ($NoTls) { "http" } else { "https" }

function Have-Cmd([string] $name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function New-Secret([int] $bytes = 32) {
    return (& node -e "console.log(require('crypto').randomBytes($bytes).toString('hex'))").Trim()
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
Section "Checking Gateway Prerequisites"
if (-not (Have-Cmd "node") -or -not (Have-Cmd "npm")) {
    Write-Host "Node.js >= 20 and npm are required to run Gateway." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js and npm found." -ForegroundColor Green

# 2. IP Resolution
if ($GatewayIp -eq "auto" -or [string]::IsNullOrWhiteSpace($GatewayIp)) {
    $GatewayIp = Get-LanIpAddress
}
Write-Host "Gateway IP/Host set to: $GatewayIp" -ForegroundColor Yellow

# 3. Secret generation
Section "Generating Secrets"
if (-not $ControllerKey) { $ControllerKey = New-Secret 32 }
if (-not $AgentKey)      { $AgentKey      = New-Secret 32 }
if (-not $JwtSecret)     { $JwtSecret     = New-Secret 48 }
if (-not $E2eePin)       { $E2eePin       = "default-pin-12345" }
Write-Host "Secrets generated successfully." -ForegroundColor Green

# 4. Write gateway/.env
Section "Configuring Gateway .env"
$env_path = Join-Path $gateway_dir ".env"
if ((Test-Path $env_path) -and -not $Force) {
    Write-Host "gateway/.env exists - keeping existing file (use -Force to overwrite)." -ForegroundColor DarkGray
} else {
    $allowed_origin = "${scheme}://${GatewayIp}:5173,http://${GatewayIp}:5173,http://localhost:5173,https://localhost:5173"
    $env_body = @"
PORT=8080
AGENT_KEY=$AgentKey
CONTROLLER_KEY=$ControllerKey
JWT_SECRET=$JwtSecret
PING_INTERVAL=30000
PING_TIMEOUT=10000
LOG_LEVEL=info
TLS_ENABLED=$(if ($NoTls) { 'false' } else { 'true' })
TLS_CERT_PATH=./certs/server.cert
TLS_KEY_PATH=./certs/server.key
ALLOWED_ORIGINS=$allowed_origin
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX_REQUESTS=10
"@
    Set-Content -Path $env_path -Value $env_body -Encoding utf8
    Write-Host "Wrote gateway/.env" -ForegroundColor Green
}

# 5. TLS Certificate
if (-not $NoTls) {
    Section "Generating Certificate"
    $cert_args = @{ Cn = $GatewayIp }
    if ($Force) { $cert_args.Force = $true }
    & (Join-Path $PSScriptRoot "gen-cert.ps1") @cert_args
}

# 6. Install Dependencies & Seed SQLite Admin
Section "Installing Dependencies & Seeding DB"
Push-Location $gateway_dir
if (Test-Path (Join-Path $gateway_dir "package-lock.json")) { npm ci } else { npm install }

$admin_hash = (& node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" $AdminPassword).Trim()
& node -e "require('./src/db').queries.upsertUser('admin', process.argv[1], 'admin')" $admin_hash
Pop-Location
Write-Host "Admin user seeded into SQLite." -ForegroundColor Green

# 7. Summary
Section "Gateway Setup Complete"
Write-Host "Record these keys to setup Controller and Agent on other machines:" -ForegroundColor Yellow
Write-Host ("  Gateway IP     : {0}" -f $GatewayIp)
Write-Host ("  CONTROLLER_KEY : {0}" -f $ControllerKey)
Write-Host ("  AGENT_KEY      : {0}" -f $AgentKey)
Write-Host ("  E2EE PIN       : {0}" -f $E2eePin)
Write-Host ("  Admin Account  : admin / {0}" -f $AdminPassword)
Write-Host ""
Write-Host "To launch Gateway:" -ForegroundColor Cyan
Write-Host "  cd gateway; npm start" -ForegroundColor Gray
