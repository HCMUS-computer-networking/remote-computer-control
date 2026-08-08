# setup-agent.ps1 - Setup script specifically for Agent component (.NET 8 Windows client)
# Usage:
#   pwsh ./scripts/setup-agent.ps1 -GatewayIp 192.168.1.50 -AgentKey <key_from_gateway> -E2eePin <pin>
#   pwsh ./scripts/setup-agent.ps1 -GatewayIp 192.168.1.50

param(
    [string] $GatewayIp = "auto",                                                       # Gateway Host/IP (default 'auto' detects local LAN IP)
    [string] $AgentKey = "",                                                            # AGENT_KEY from Gateway
    [string] $E2eePin = "default-pin-12345",                                            # E2EE PIN shared secret
    [string] $AgentId = $env:COMPUTERNAME,                                              # Unique Agent ID
    [switch] $NoTls,                                                                    # Set ws:// scheme instead of wss://
    [switch] $Force                                                                     # Overwrite existing config files
)

$ErrorActionPreference = "Stop"

$repo_root = Split-Path -Parent $PSScriptRoot
$agent_dir = Join-Path $repo_root "agent"
$ws_scheme = if ($NoTls) { "ws" } else { "wss" }

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
Section "Checking Agent Prerequisites"
if (-not (Have-Cmd "dotnet")) {
    Write-Host ".NET 8 SDK is required to build and run Agent." -ForegroundColor Red
    Write-Host "Download from: https://dotnet.microsoft.com/download" -ForegroundColor Yellow
    exit 1
}
Write-Host ".NET 8 SDK found." -ForegroundColor Green

# 2. IP Resolution
if ($GatewayIp -eq "auto" -or [string]::IsNullOrWhiteSpace($GatewayIp)) {
    $GatewayIp = Get-LanIpAddress
}
Write-Host "Target Gateway IP: $GatewayIp" -ForegroundColor Yellow

# 3. Check Agent Key
if (-not $AgentKey) {
    # Try reading from gateway/.env if it exists on the same machine
    $gw_env = Join-Path $repo_root "gateway\.env"
    if (Test-Path $gw_env) {
        $match = Get-Content $gw_env | Select-String "^AGENT_KEY=(.+)$"
        if ($match) {
            $AgentKey = $match.Matches[0].Groups[1].Value.Trim()
            Write-Host "Auto-detected AGENT_KEY from local gateway/.env" -ForegroundColor Green
        }
    }
}

if (-not $AgentKey) {
    Write-Host "[WARNING] -AgentKey was not provided!" -ForegroundColor Yellow
    Write-Host "Please pass -AgentKey <key_from_gateway> or edit agent/config.json manually." -ForegroundColor Yellow
}

# 4. Generate agent config JSON
Section "Configuring Agent"
$agent_cfg = [ordered]@{
    agent_id            = $AgentId
    gateway_url         = "${ws_scheme}://${GatewayIp}:8080"
    auth_key            = $AgentKey
    e2ee_shared_secret  = $E2eePin
    app_whitelist       = @("notepad", "calc", "chrome", "winword")
    sandbox_root_path   = "C:\AgentSandbox\"
    log_retention_days  = 7
    consent_timeout_ms  = 30000
    tray_password       = ""
}

# Write agent/config.json
$agent_cfg_main = Join-Path $agent_dir "config.json"
if ((-not (Test-Path $agent_cfg_main)) -or $Force) {
    $agent_cfg | ConvertTo-Json -Depth 5 | Set-Content -Path $agent_cfg_main -Encoding utf8
    Write-Host "Wrote agent/config.json" -ForegroundColor Green
} else {
    Write-Host "agent/config.json exists - keeping existing file (use -Force to overwrite)." -ForegroundColor DarkGray
}

# Write agent/config.local.json
$agent_cfg_local = Join-Path $agent_dir "config.local.json"
if ((-not (Test-Path $agent_cfg_local)) -or $Force) {
    $agent_cfg | ConvertTo-Json -Depth 5 | Set-Content -Path $agent_cfg_local -Encoding utf8
    Write-Host "Wrote agent/config.local.json" -ForegroundColor Green
}

# 5. Build C# Agent
Section "Building C# Agent (.NET 8)"
Push-Location $agent_dir
dotnet build agent.sln -c Release
Pop-Location

# Copy config.json to build bin output directory
$bin_config_dir = Join-Path $agent_dir "bin\Release\net8.0-windows"
if (Test-Path $bin_config_dir) {
    $agent_cfg | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $bin_config_dir "config.json") -Encoding utf8
    Write-Host "Wrote config.json to agent/bin/Release/net8.0-windows/" -ForegroundColor Green
}

# 6. Summary
Section "Agent Setup Complete"
Write-Host ("Agent ID           : {0}" -f $AgentId) -ForegroundColor Yellow
Write-Host ("Target Gateway URL : {0}://{1}:8080" -f $ws_scheme, $GatewayIp) -ForegroundColor Yellow
Write-Host ""
Write-Host "To run Agent (Run PowerShell as Administrator):" -ForegroundColor Cyan
Write-Host "  .\agent\bin\Release\net8.0-windows\agent.exe" -ForegroundColor Gray
