#!/usr/bin/env bash
# Baut Drehscheibe-Setup.bat: eine einzige Datei, in der das komplette Installationspaket steckt.
set -euo pipefail
rm -rf dist && mkdir -p dist/pkg
cp -r app install.ps1 uninstall.ps1 Deinstallieren.bat dist/pkg/
(cd dist/pkg && zip -qr ../payload.zip .)
{
  printf '@echo off\r\n'
  printf 'chcp 65001 >nul\r\n'
  printf 'title Drehscheibe installieren\r\n'
  printf 'echo Drehscheibe wird vorbereitet ...\r\n'
  printf 'set "SELF=%%~f0"\r\n'
  printf '%s\r\n' "powershell -NoProfile -ExecutionPolicy Bypass -Command \"\$l=[IO.File]::ReadAllLines(\$env:SELF); \$i=[Array]::IndexOf(\$l,':PAYLOAD'); \$b=[Convert]::FromBase64String((\$l[(\$i+1)..(\$l.Length-1)] -join '')); \$d=Join-Path \$env:TEMP 'drehscheibe-pkg'; if(Test-Path \$d){Remove-Item \$d -Recurse -Force}; New-Item -ItemType Directory \$d | Out-Null; \$z=Join-Path \$d 'p.zip'; [IO.File]::WriteAllBytes(\$z,\$b); & tar.exe -xf \$z -C \$d; if(\$LASTEXITCODE -ne 0){Expand-Archive \$z \$d -Force}; & (Join-Path \$d 'install.ps1'); Set-Location \$env:TEMP; Remove-Item \$d -Recurse -Force -ErrorAction SilentlyContinue\""
  printf 'echo.\r\n'
  printf 'pause\r\n'
  printf 'exit /b\r\n'
  printf ':PAYLOAD\r\n'
  base64 -w76 dist/payload.zip | sed 's/$/\r/'
} > dist/Drehscheibe-Setup.bat
(cd dist && zip -q Drehscheibe-Setup.zip Drehscheibe-Setup.bat)
