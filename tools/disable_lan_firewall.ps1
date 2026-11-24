# Run PowerShell as Administrator to remove the PySmartHome LAN rule.
$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -DisplayName 'PySmartHome-PC LAN TCP 5000' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'PySmartHome-PC LAN firewall rule removed.' -ForegroundColor Green
