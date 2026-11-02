# Installiert die Drehscheibe nach %LOCALAPPDATA%\Drehscheibe (ohne Administratorrechte).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$ElectronVersion = '33.4.11'
$ElectronUrl = "https://github.com/electron/electron/releases/download/v$ElectronVersion/electron-v$ElectronVersion-win32-x64.zip"
$FfmpegUrl = 'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip'

$Target = Join-Path $env:LOCALAPPDATA 'Drehscheibe'
$Src = Join-Path $PSScriptRoot 'app'
$Tmp = Join-Path $env:TEMP ('drehscheibe-setup-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Step($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Download($url, $file) {
  Write-Host "   Lade: $url"
  Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
  if (-not (Test-Path $file) -or (Get-Item $file).Length -lt 1MB) { throw "Download fehlgeschlagen: $url" }
}
function Unzip($zip, $dest) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  & tar.exe -xf $zip -C $dest
  if ($LASTEXITCODE -ne 0) { Expand-Archive -Path $zip -DestinationPath $dest -Force }
}

try {
  if (-not (Test-Path (Join-Path $Src 'main.js'))) { throw "Der Ordner 'app' fehlt neben dieser Datei. Bitte das ZIP zuerst komplett entpacken." }

  Step 'Laufende Drehscheibe beenden'
  Get-Process -Name 'Drehscheibe' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 700

  New-Item -ItemType Directory -Force -Path $Target, $Tmp | Out-Null
  $Exe = Join-Path $Target 'Drehscheibe.exe'
  $VerFile = Join-Path $Target 'electron-version.txt'

  $have = ''
  if (Test-Path $VerFile) { $have = (Get-Content $VerFile -Raw).Trim() }
  if (-not (Test-Path $Exe) -or $have -ne $ElectronVersion) {
    Step "Programmgrundlage laden (Electron $ElectronVersion, ca. 115 MB)"
    $zip = Join-Path $Tmp 'electron.zip'
    Download $ElectronUrl $zip
    Step 'Entpacken'
    Unzip $zip $Target
    if (Test-Path $Exe) { Remove-Item $Exe -Force }
    Rename-Item (Join-Path $Target 'electron.exe') 'Drehscheibe.exe'
    Set-Content -Path $VerFile -Value $ElectronVersion
  } else {
    Step 'Programmgrundlage ist schon vorhanden'
  }

  Step 'Drehscheibe-Dateien kopieren'
  $AppDir = Join-Path $Target 'resources\app'
  if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  Copy-Item -Path (Join-Path $Src '*') -Destination $AppDir -Recurse -Force
  Copy-Item -Path (Join-Path $Src 'icon.ico') -Destination (Join-Path $Target 'icon.ico') -Force
  Copy-Item -Path (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination $Target -Force
  Copy-Item -Path (Join-Path $PSScriptRoot 'Deinstallieren.bat') -Destination $Target -Force

  $Ff = Join-Path $Target 'bin\ffmpeg.exe'
  if (-not (Test-Path $Ff)) {
    Step 'ffmpeg laden (fuer Bilder, Audio und Video, ca. 90 MB)'
    $zip = Join-Path $Tmp 'ffmpeg.zip'
    Download $FfmpegUrl $zip
    Step 'ffmpeg entpacken'
    $ex = Join-Path $Tmp 'ff'
    Unzip $zip $ex
    $found = Get-ChildItem -Path $ex -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
    if (-not $found) { throw 'ffmpeg.exe wurde im Download nicht gefunden.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $Target 'bin') | Out-Null
    Copy-Item $found.FullName $Ff -Force
  } else {
    Step 'ffmpeg ist schon vorhanden'
  }

  Step 'Verknuepfungen anlegen'
  $ws = New-Object -ComObject WScript.Shell
  $links = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Drehscheibe.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Drehscheibe.lnk')
  )
  foreach ($l in $links) {
    $s = $ws.CreateShortcut($l)
    $s.TargetPath = $Exe
    $s.WorkingDirectory = $Target
    $s.IconLocation = (Join-Path $Target 'icon.ico')
    $s.Description = 'Drehscheibe: Dateien umwandeln'
    $s.Save()
  }

  Write-Host ''
  Write-Host 'Fertig! Die Drehscheibe ist installiert.' -ForegroundColor Green
  Write-Host "Ort: $Target"
  $a = Read-Host 'Jetzt starten? (J/N)'
  if ($a -match '^[JjYy]') { Start-Process $Exe }
}
catch {
  Write-Host ''
  Write-Host "FEHLER: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Pruefe deine Internetverbindung und starte Installieren.bat noch einmal.'
}
finally {
  if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
