# setup.ps1 - one-shot bootstrap for Remote Computer Control.
#
# Turns a fresh clone into a runnable system with as little manual work as
# possible. It generates every shared secret ONCE and writes it consistently
# into gateway/.env, controller/.env and the Agent config, so the four secrets
# never drift out of sync. Re-runnable; existing files are kept unless -Force.
#
# Manual prerequisites (cannot be scripted - install these yourself):
#   * Node.js >= 20  + npm      (Gateway + Controller)
#   * .NET 8 SDK                (Agent - only on the Agent machine)
#   * Git for Windows           (clone + bundles openssl for the TLS cert)
#
# Usage (from repo root):
#   pwsh ./scripts/setup.ps1                       # single-machine demo (all)
#   pwsh ./scripts/setup.ps1 -GatewayIp 192.168.1.50
#   pwsh ./scripts/setup.ps1 -Component gateway    # only this machine's role
#   pwsh ./scripts/setup.ps1 -Component agent -GatewayIp 192.168.1.50 `
#         -AgentKey <key> -E2eePin <pin>           # agent machine, keys from gateway
#   pwsh ./scripts/setup.ps1 -Force                # regenerate secrets/cert/env

param(
    [ValidateSet("all", "gateway", "controller", "agent")]
    [string] $Component = "all",                                                        # Which role(s) to set up on this machine
    [string] $GatewayIp = "localhost",                                                  # Host/IP the Controller + Agent dial
    [string] $AdminPassword = "admin123",                                              # Seeded Controller login password
    [string] $AgentKey = "",                                                            # Agent shared key (paste from gateway on an agent-only machine)
    [string] $E2eePin = "",                                                             # E2EE PIN (paste from gateway on an agent-only machine)
    [switch] $NoTls,                                                                    # Set TLS_ENABLED=false (plain HTTP/WS, dev only)
    [switch] $Force                                                                     # Overwrite existing .env / cert / secrets
)

$ErrorActionPreference = "Stop"

$repo_root      = Split-Path -Parent $PSScriptRoot
$gateway_dir    = Join-Path $repo_root "gateway"
$controller_dir = Join-Path $repo_root "controller"
$agent_dir      = Join-Path $repo_root "agent"

$scheme      = if ($NoTls) { "http" }  else { "https" }                                 # REST scheme
$ws_scheme   = if ($NoTls) { "ws" }    else { "wss" }                                   # WebSocket scheme
$tls_enabled = if ($NoTls) { "false" } else { "true" }                                  # TLS_ENABLED value for .env

# -- Helpers ------------------------------------------------------------------
function Have-Cmd([string] $name)                                                       # Is a command on PATH?
{
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function New-Secret([int] $bytes = 32)                                                   # Random hex secret via Node's crypto
{
    return (& node -e "console.log(require('crypto').randomBytes($bytes).toString('hex'))").Trim()
}

function Section([string] $text)
{
    Write-Host ""
    Write-Host "-- $text " -ForegroundColor Cyan -NoNewline
    Write-Host ("-" * [Math]::Max(1, 60 - $text.Length)) -ForegroundColor Cyan
}

# -- Prerequisite check -------------------------------------------------------
Section "Checking prerequisites"

$need_node   = $Component -in @("all", "gateway", "controller")
$need_dotnet = $Component -in @("all", "agent")

$missing = @()
if ($need_node   -and -not (Have-Cmd "node")) { $missing += "Node.js >= 20 (https://nodejs.org)" }
if ($need_node   -and -not (Have-Cmd "npm"))  { $missing += "npm (ships with Node.js)" }
if ($need_dotnet -and -not (Have-Cmd "dotnet")) { $missing += ".NET 8 SDK (https://dotnet.microsoft.com/download)" }

if ($missing.Count -gt 0)
{
    Write-Host "Missing required tools:" -ForegroundColor Red
    foreach ($m in $missing) { Write-Host "    - $m" -ForegroundColor Yellow }
    Write-Host "Install them, then re-run this script." -ForegroundColor Yellow
    exit 1
}
Write-Host "All required tools found." -ForegroundColor Green

# -- Secret generation (shared across gateway + controller + agent) -----------
# On an agent-only machine the operator pastes AgentKey + E2eePin that the
# gateway printed, so we do NOT invent new ones there.
$controller_key = ""
$agent_key      = $AgentKey
$jwt_secret     = ""
$e2ee_pin       = $E2eePin

if ($Component -in @("all", "gateway", "controller"))
{
    Section "Generating shared secrets"
    $controller_key = New-Secret 32
    $jwt_secret     = New-Secret 48
    if (-not $agent_key) { $agent_key = New-Secret 32 }
    if (-not $e2ee_pin)  { $e2ee_pin  = New-Secret 8  }                                 # 16 hex chars - short enough to type on the Controller
    Write-Host "Secrets generated (shown in the summary at the end)." -ForegroundColor Green
}

# -- Gateway ------------------------------------------------------------------
if ($Component -in @("all", "gateway"))
{
    Section "Gateway"

    # .env - write only if absent or -Force, so re-runs don't rotate live keys.
    $env_path = Join-Path $gateway_dir ".env"
    if ((Test-Path $env_path) -and -not $Force)
    {
        Write-Host "gateway/.env exists - keeping it (use -Force to overwrite)." -ForegroundColor DarkGray
    }
    else
    {
        $allowed_origin = "${scheme}://${GatewayIp}:5173,http://localhost:5173"
        $env_body = @"
PORT=8080
AGENT_KEY=$agent_key
CONTROLLER_KEY=$controller_key
JWT_SECRET=$jwt_secret
PING_INTERVAL=30000
PING_TIMEOUT=10000
LOG_LEVEL=info
TLS_ENABLED=$tls_enabled
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

    # TLS cert (skip in -NoTls mode).
    if (-not $NoTls)
    {
        $cert_args = @{ Cn = $GatewayIp }
        if ($Force) { $cert_args.Force = $true }
        & (Join-Path $PSScriptRoot "gen-cert.ps1") @cert_args
    }

    # Dependencies.
    Write-Host "Installing gateway dependencies..." -ForegroundColor Green
    Push-Location $gateway_dir
    if (Test-Path (Join-Path $gateway_dir "package-lock.json")) { npm ci } else { npm install }

    # Seed the admin user into SQLite (bcrypt hash - plaintext never stored).
    Write-Host "Seeding admin user into SQLite..." -ForegroundColor Green
    $admin_hash = (& node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" $AdminPassword).Trim()
    & node -e "require('./src/db').queries.upsertUser('admin', process.argv[1], 'admin')" $admin_hash
    Pop-Location
    Write-Host "Admin seeded (username: admin)." -ForegroundColor Green
}

# -- Controller ---------------------------------------------------------------
if ($Component -in @("all", "controller"))
{
    Section "Controller"

    $cenv_path = Join-Path $controller_dir ".env"
    if ((Test-Path $cenv_path) -and -not $Force)
    {
        Write-Host "controller/.env exists - keeping it (use -Force to overwrite)." -ForegroundColor DarkGray
    }
    else
    {
        if (-not $controller_key)
        {
            Write-Host "No CONTROLLER_KEY available. Run with -Component all/gateway first," -ForegroundColor Red
            Write-Host "or paste the gateway's CONTROLLER_KEY into controller/.env manually." -ForegroundColor Yellow
        }
        $cenv_body = @"
VITE_GATEWAY_URL=${ws_scheme}://${GatewayIp}:8080
VITE_CONTROLLER_KEY=$controller_key
VITE_USE_MOCK=false
"@
        Set-Content -Path $cenv_path -Value $cenv_body -Encoding utf8
        Write-Host "Wrote controller/.env" -ForegroundColor Green
    }

    Write-Host "Installing controller dependencies..." -ForegroundColor Green
    Push-Location $controller_dir
    if (Test-Path (Join-Path $controller_dir "package-lock.json")) { npm ci } else { npm install }
    Pop-Location
}

# -- Agent --------------------------------------------------------------------
if ($Component -in @("all", "agent"))
{
    Section "Agent"

    if (-not $agent_key -or -not $e2ee_pin)
    {
        Write-Host "AGENT_KEY / E2EE PIN not available on this machine." -ForegroundColor Yellow
        Write-Host "On an agent-only machine, pass them from the gateway:" -ForegroundColor Yellow
        Write-Host "    pwsh ./scripts/setup.ps1 -Component agent -GatewayIp <ip> -AgentKey <key> -E2eePin <pin>" -ForegroundColor Gray
    }
    else
    {
        # config.local.json is gitignored - it holds this machine's live secrets.
        $agent_cfg_path = Join-Path $agent_dir "config.local.json"
        if ((Test-Path $agent_cfg_path) -and -not $Force)
        {
            Write-Host "agent/config.local.json exists - keeping it (use -Force to overwrite)." -ForegroundColor DarkGray
        }
        else
        {
            $agent_cfg = [ordered]@{
                agent_id            = $env:COMPUTERNAME
                gateway_url         = "${ws_scheme}://${GatewayIp}:8080"
                auth_key            = $agent_key
                e2ee_shared_secret  = $e2ee_pin
                app_whitelist       = @("notepad", "calc", "chrome", "winword")
                sandbox_root_path   = "C:\AgentSandbox\"
                log_retention_days  = 7
                consent_timeout_ms  = 30000
                tray_password       = ""
            }
            $agent_cfg | ConvertTo-Json -Depth 5 | Set-Content -Path $agent_cfg_path -Encoding utf8
            Write-Host "Wrote agent/config.local.json (copy to config.json next to agent.exe after build)." -ForegroundColor Green
        }
    }

    if (Have-Cmd "dotnet")
    {
        Write-Host "Building agent (Release)..." -ForegroundColor Green
        Push-Location $agent_dir
        dotnet build agent.sln -c Release
        Pop-Location
    }
}

# -- Summary ------------------------------------------------------------------
Section "Done"
if ($controller_key -or $agent_key -or $e2ee_pin)
{
    Write-Host "Generated secrets - record these to configure other machines:" -ForegroundColor Yellow
    if ($controller_key) { Write-Host ("  CONTROLLER_KEY : {0}" -f $controller_key) }
    if ($agent_key)      { Write-Host ("  AGENT_KEY      : {0}" -f $agent_key) }
    if ($jwt_secret)     { Write-Host ("  JWT_SECRET     : {0}" -f $jwt_secret) }
    if ($e2ee_pin)       { Write-Host ("  E2EE PIN       : {0}  (enter this on the Controller to unlock an agent)" -f $e2ee_pin) }
    Write-Host ("  Login          : admin / {0}" -f $AdminPassword)
}
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  Gateway:    cd gateway && npm start" -ForegroundColor Gray
Write-Host "  Controller: cd controller && npm run dev -- --host   (${scheme}://${GatewayIp}:5173)" -ForegroundColor Gray
Write-Host "  Agent:      run agent/bin/Release/net8.0-windows/agent.exe (copy config.local.json -> config.json beside it)" -ForegroundColor Gray
if (-not $NoTls)
{
    Write-Host "  TLS: open ${scheme}://${GatewayIp}:8080/health once and accept the self-signed cert." -ForegroundColor Gray
}
