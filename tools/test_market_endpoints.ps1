$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:5000'
$apiFile = 'https://api.github.com/repos/mehrdadmb2/PySmartHome-PC/contents/market/esp32.json?ref=main'
$rawFile = 'https://raw.githubusercontent.com/mehrdadmb2/PySmartHome-PC/main/market/esp32.json'
$lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress -Unique)
Write-Host '=== PySmartHome-PC market diagnostics ===' -ForegroundColor Cyan
Write-Host ('PC IPv4 candidates: ' + ($lanAddresses -join ', '))
Write-Host '\n[1] Local health endpoint'
try {
  $health = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5
  $health | Select-Object version,market_proxy_ready,market_proxy_age_seconds,market_proxy_error,market_proxy_source,market_lan_access_enabled | Format-List
} catch { Write-Warning "Local health failed: $($_.Exception.Message)" }
Write-Host '\n[2] Local market endpoint'
try {
  $market = Invoke-RestMethod -Uri "$base/api/market" -TimeoutSec 5
  $market | Format-List
} catch { Write-Warning "Local market failed: $($_.Exception.Message)" }
Write-Host '\n[3] GitHub Contents API exact-file endpoint'
try {
  $headers = @{ Accept = 'application/vnd.github.raw+json'; 'User-Agent' = 'PySmartHome-PC-diagnostics' }
  $remote = Invoke-RestMethod -Uri $apiFile -Headers $headers -TimeoutSec 10
  $remote | Format-List
} catch { Write-Warning "GitHub API market file failed: $($_.Exception.Message)" }
Write-Host '\n[4] Raw GitHub exact-file fallback'
try {
  $raw = Invoke-RestMethod -Uri $rawFile -TimeoutSec 10
  $raw | Format-List
} catch { Write-Warning "Raw GitHub fallback failed: $($_.Exception.Message)" }
Write-Host '\n[5] TCP/5000 listener'
try {
  Get-NetTCPConnection -State Listen -LocalPort 5000 -ErrorAction Stop | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize
} catch { Write-Warning 'No listener found on TCP/5000. Check that server.py is running.' }
Write-Host '\nIf local API works but the LAN URL does not, run tools/enable_lan_firewall.ps1 as Administrator and test http://<PC-IP>:5000/api/market from another device.' -ForegroundColor Yellow
