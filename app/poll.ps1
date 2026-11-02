# Beobachtet die linke Maustaste und die Strg-Taste (ohne Hook, nur Abfrage) und meldet:
#   D1  = Linksklick MIT Strg      D0 = Linksklick ohne Strg      U = Maustaste losgelassen
#   S[...] = JSON-Liste der markierten Dateien (Desktop oder Explorer) direkt nach D1
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Dh {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
}
"@
$shell = New-Object -ComObject Shell.Application

function Get-Sel {
  $paths = @()
  $fgPtr = [Dh]::GetForegroundWindow()
  $fg = $fgPtr.ToInt64()
  $sb = New-Object System.Text.StringBuilder 256
  [void][Dh]::GetClassName($fgPtr, $sb, 256)
  $cls = $sb.ToString()
  foreach ($w in $shell.Windows()) {
    try {
      if ($w.HWND -eq $fg) {
        foreach ($i in $w.Document.SelectedItems()) { $paths += $i.Path }
      }
    } catch {}
  }
  if ($paths.Count -eq 0 -and ($cls -eq 'Progman' -or $cls -eq 'WorkerW')) {
    try {
      $v = [System.Reflection.Missing]::Value
      $h = 0
      $d = $shell.Windows().FindWindowSW([ref]$v, [ref]$v, 8, [ref]$h, 1)
      foreach ($i in $d.Document.SelectedItems()) { $paths += $i.Path }
    } catch {}
  }
  return , $paths
}

$prev = $false
while ($true) {
  $l = ([Dh]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
  $c = ([Dh]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0
  if ($l -and -not $prev) {
    if ($c) {
      [Console]::Out.WriteLine('D1'); [Console]::Out.Flush()
      Start-Sleep -Milliseconds 90
      $s = Get-Sel
      $json = ConvertTo-Json -InputObject @($s) -Compress
      [Console]::Out.WriteLine('S' + $json); [Console]::Out.Flush()
    } else {
      [Console]::Out.WriteLine('D0'); [Console]::Out.Flush()
    }
  }
  if (-not $l -and $prev) { [Console]::Out.WriteLine('U'); [Console]::Out.Flush() }
  $prev = $l
  Start-Sleep -Milliseconds 12
}
