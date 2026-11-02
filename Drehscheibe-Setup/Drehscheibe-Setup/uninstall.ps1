# Entfernt die Drehscheibe wieder.
$ErrorActionPreference = 'SilentlyContinue'
$Target = Join-Path $env:LOCALAPPDATA 'Drehscheibe'
Get-Process -Name 'Drehscheibe' | Stop-Process -Force
Start-Sleep -Milliseconds 700
& reg.exe delete 'HKCU\Software\Classes\*\shell\Drehscheibe' /f 2>$null | Out-Null
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Drehscheibe.lnk') -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Drehscheibe.lnk') -Force
# Autostart-Eintrag
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'electron.app.Drehscheibe' -Force
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Drehscheibe' -Force
if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
Write-Host 'Die Drehscheibe wurde entfernt.' -ForegroundColor Green
