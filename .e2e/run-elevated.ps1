# Run a real-USB E2E script with administrator rights.
# Right-click this file and choose "Run with PowerShell", or from an elevated shell:
#   powershell -ExecutionPolicy Bypass -File .e2e\run-elevated.ps1 [script] [device]
#
#   script : 'write' (default, scripts/e2e-write-usb.mts)
#            'worker'          (scripts/e2e-worker-usb.mts - goes through the elevated worker)
#   device : optional physical drive path, e.g. \.\PhysicalDrive1
#            When omitted the script picks the first selectable USB device itself,
#            which is safer than hard-coding a drive number that may shift between boots.
$repo = Split-Path -Parent $PSScriptRoot
$which  = if ($args.Count -gt 0) { $args[0] } else { 'write' }
$device = if ($args.Count -gt 1) { $args[1] } else { $null }
$log = Join-Path $repo ('.e2e\usb-' + $which + '.log')

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Output 'Not elevated. Relaunching with UAC...'
  $fwd = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), $which)
  if ($device) { $fwd += $device }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $fwd
  exit
}

# PS 5.1 reads a child process's stdout with the OEM code page (932 here), which
# mangles the scripts' Japanese output into mojibake before it ever reaches the log.
# Force UTF-8 on both directions so the log stays readable.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$script = if ($which -eq 'worker') { 'scripts/e2e-worker-usb.mts' } else { 'scripts/e2e-write-usb.mts' }
Set-Location $repo
if (Test-Path $log) { Remove-Item $log -Force }
$cliArgs = @('tsx', $script)
if ($device) { $cliArgs += @('--device', $device) }
$cliArgs += '--yes'
Write-Output ("Running " + ($cliArgs -join ' ') + "  (log: $log)")
# 「どのコードで走ったか」（HEAD と作業ツリーの汚れ）は **.mts スクリプト側が**
# 実行開始時に出す（scripts/lib/git-revision.mts の printRevisionBanner）。
# その出力は下の tee でそのままログへ入るので、**ここでは出さない。**
# 両方で出すと同じ情報が 2 行並び、食い違ったときにどちらが本当か分からなくなる。
# ログを消してから npx を起動するので、バナーがログの 1 行目になる。
# Tee-Object has no -Encoding on PS 5.1 and defaults to UTF-16, which grep/tail cannot read.
# Write each line as UTF-8 instead so the log stays greppable.
& npx @cliArgs 2>&1 | ForEach-Object {
  $line = [string]$_
  $line | Out-File -FilePath $log -Append -Encoding utf8
  Write-Output $line
}
$code = $LASTEXITCODE
"EXITCODE=$code" | Out-File -FilePath $log -Append -Encoding utf8
Write-Output ("EXITCODE=" + $code)
Write-Output 'Press Enter to close.'
[void][Console]::ReadLine()
