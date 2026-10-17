<#
    redeploy.ps1 - push Chonk to the EC2 box (same host as Star Drop, Half
    Baked, Bananagrams, Cabo, Rummikub and Big Two) and (re)start it.

    Usage:   .\redeploy.ps1
             .\redeploy.ps1 -KeyPath C:\path\to\key.pem
             .\redeploy.ps1 -SkipVerify

    First run on a fresh box also creates the systemd unit and the Caddy site
    block for chonk.kat.lu (idempotent - safe to run again). It does NOT
    touch DNS; add chonk.kat.lu -> 16.16.219.170 at EuroDNS yourself before
    the first deploy, or Caddy can't get a TLS cert.
#>
param(
    [string]$KeyPath    = "$env:USERPROFILE\Downloads\key.pem",
    [string]$RemoteHost = "16.16.219.170",
    [string]$User       = "ec2-user",
    [string]$RemoteDir  = "/opt/chonk",
    [string]$Service    = "chonk",
    [int]$Port          = 8086,
    [string]$Domain     = "chonk.kat.lu",
    [string]$Url        = "https://chonk.kat.lu/",
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$ProjectDir = $PSScriptRoot
$Tarball    = Join-Path $env:TEMP "chonk-deploy.tgz"
$Remote     = "$User@$RemoteHost"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Die($msg)  { Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $KeyPath)) {
    Die "SSH key not found at $KeyPath. Pass -KeyPath with the right location."
}

# --- 1. package -----------------------------------------------------------
Step "Packaging $ProjectDir"
if (Test-Path $Tarball) { Remove-Item $Tarball -Force }
tar -czf $Tarball -C $ProjectDir `
    --exclude=node_modules --exclude=.git --exclude=.claude --exclude=dist --exclude=tests --exclude=.github .
if ($LASTEXITCODE -ne 0) { Die "tar exited $LASTEXITCODE" }
$kb = "{0:N1}" -f ((Get-Item $Tarball).Length / 1KB)
Write-Host "    $kb KB"

# --- 2. upload --------------------------------------------------------------
Step "Uploading to ${Remote}:/tmp/"
scp -i $KeyPath -o StrictHostKeyChecking=accept-new $Tarball "${Remote}:/tmp/chonk-deploy.tgz"
if ($LASTEXITCODE -ne 0) { Die "scp exited $LASTEXITCODE" }

# --- 3. unpack, install, ensure unit + Caddy block, restart -----------------
Step "Unpacking, provisioning and restarting $Service"

$unitFile = "/etc/systemd/system/$Service.service"
$unitBody = @"
[Unit]
Description=Chonk
After=network.target

[Service]
Type=simple
WorkingDirectory=$RemoteDir
Environment=PORT=$Port
ExecStart=/usr/bin/node $RemoteDir/server/index.mjs
Restart=on-failure
User=$User

[Install]
WantedBy=multi-user.target
"@ -replace "`r", ""

$caddyBlock = @"
$Domain {
    reverse_proxy 127.0.0.1:$Port
    encode gzip
}
"@ -replace "`r", ""

# base64 both so they survive the ssh round-trip untouched
$unitB64  = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($unitBody))
$caddyB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($caddyBlock))

$remoteCmd = @"
set -e
sudo mkdir -p $RemoteDir; sudo chown $User $RemoteDir
tar -xzf /tmp/chonk-deploy.tgz -C $RemoteDir; rm -f /tmp/chonk-deploy.tgz
cd $RemoteDir; npm install --omit=dev --no-audit --no-fund --silent

if [ ! -f $unitFile ]; then
  echo '$unitB64' | base64 -d | sudo tee $unitFile > /dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable $Service
fi

if ! sudo grep -q '$Domain' /etc/caddy/Caddyfile 2>/dev/null; then
  { echo; echo '$caddyB64' | base64 -d; } | sudo tee -a /etc/caddy/Caddyfile > /dev/null
  sudo systemctl reload caddy
fi

sudo systemctl restart $Service; sleep 1
systemctl is-active $Service
"@ -replace "`r", ""

ssh -i $KeyPath -o StrictHostKeyChecking=accept-new $Remote $remoteCmd
if ($LASTEXITCODE -ne 0) { Die "remote deploy exited $LASTEXITCODE" }

Remove-Item $Tarball -Force -ErrorAction SilentlyContinue

# --- 4. prove it actually serves --------------------------------------------
if (-not $SkipVerify) {
    Step "Verifying $Url"
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 25
        if ($r.StatusCode -eq 200) {
            Write-Host "    HTTP 200, $($r.RawContentLength) bytes" -ForegroundColor Green
        } else {
            Die "got HTTP $($r.StatusCode)"
        }
    } catch {
        Write-Host "    could not reach $Url - $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "    If this is the first deploy, check chonk.kat.lu has an A" -ForegroundColor Yellow
        Write-Host "    record pointing at $RemoteHost - Caddy cannot get a TLS" -ForegroundColor Yellow
        Write-Host "    cert until it resolves." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""
Write-Host "Deployed. $Url" -ForegroundColor Green
