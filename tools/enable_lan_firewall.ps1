# Run PowerShell as Administrator. Allows only devices on the local subnet
# to reach the PySmartHome Flask service while Windows is using the Private profile.
$ErrorActionPreference = 'Stop'
$ruleName = 'PySmartHome-PC LAN TCP 5000'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) { Remove-NetFirewallRule -DisplayName $ruleName }
New-NetFirewallRule `
  -DisplayName $ruleName `
  -Description 'Allow ESP32 nodes on the trusted local subnet to reach PySmartHome-PC.' `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 5000 `
  -RemoteAddress LocalSubnet `
  -Profile Private | Out-Null
Write-Host 'PySmartHome-PC LAN access enabled for Private profile / LocalSubnet only.' -ForegroundColor Green
Write-Host 'Do not create a router port-forward for TCP 5000.' -ForegroundColor Yellow
