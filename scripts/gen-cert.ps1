# gen-cert.ps1 - generate a self-signed TLS certificate for the Gateway.
#
# Produces gateway/certs/server.key + server.cert (PEM) so the Gateway can
# serve HTTPS/WSS. Auto-detects openssl: uses it from PATH, or from the copy
# bundled with Git for Windows, so no separate openssl install is needed.
#
# Usage (from repo root):
#   pwsh ./scripts/gen-cert.ps1                 # CN=localhost
#   pwsh ./scripts/gen-cert.ps1 -Cn 192.168.1.50
#   pwsh ./scripts/gen-cert.ps1 -Force          # overwrite existing cert

param(
    [string] $Cn = "localhost",                                                        # Common Name baked into the cert
    [switch] $Force                                                                    # Overwrite an existing cert
)

$ErrorActionPreference = "Stop"

$repo_root = Split-Path -Parent $PSScriptRoot
$certs_dir = Join-Path $repo_root "gateway\certs"
$key_path  = Join-Path $certs_dir "server.key"
$cert_path = Join-Path $certs_dir "server.cert"

# -- Locate openssl: PATH first, then the Git-for-Windows bundle --------------
function Find-OpenSsl
{
    $cmd = Get-Command openssl -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "$env:ProgramFiles\Git\usr\bin\openssl.exe",
        "$env:ProgramFiles\Git\mingw64\bin\openssl.exe",
        "${env:ProgramFiles(x86)}\Git\usr\bin\openssl.exe",
        "$env:LOCALAPPDATA\Programs\Git\usr\bin\openssl.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return $null
}

if ((Test-Path $key_path) -and (Test-Path $cert_path) -and (-not $Force))
{
    Write-Host "[gen-cert] Certificate already exists - skipping (use -Force to regenerate)." -ForegroundColor DarkGray
    return
}

$openssl = Find-OpenSsl
if (-not $openssl)
{
    Write-Host "[gen-cert] ERROR: openssl not found." -ForegroundColor Red
    Write-Host "  Install Git for Windows (bundles openssl) or add openssl to PATH," -ForegroundColor Yellow
    Write-Host "  OR run the Gateway in plain HTTP/WS mode by setting TLS_ENABLED=false." -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force -Path $certs_dir | Out-Null

$san = if ([System.Net.IPAddress]::TryParse($Cn, [ref]$null)) { "IP:$Cn,DNS:localhost" } else { "DNS:$Cn,DNS:localhost" }
Write-Host "[gen-cert] Using openssl: $openssl" -ForegroundColor DarkGray
Write-Host "[gen-cert] Generating self-signed cert (CN=$Cn, SAN=$san, 365 days)..." -ForegroundColor Green

& $openssl req -x509 -newkey rsa:2048 -nodes `
    -keyout $key_path -out $cert_path -days 365 -subj "/CN=$Cn" `
    -addext "subjectAltName=$san"

if ($LASTEXITCODE -ne 0) { throw "openssl failed with exit code $LASTEXITCODE" }

Write-Host "[gen-cert] Wrote:" -ForegroundColor Green
Write-Host "    $key_path"  -ForegroundColor Gray
Write-Host "    $cert_path" -ForegroundColor Gray
