$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$secretDirectory = 'C:\Users\Admin\.codex\shared-access\secrets'
$profile = Join-Path $secretDirectory 'ec10-whatsapp-web-bridge.env'
$taskName = 'EC10 Gustavo WhatsApp Web'
$runner = Join-Path $repository 'scripts\run-whatsapp-web-bridge.ps1'

New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
if (-not (Test-Path -LiteralPath $profile)) {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $secret = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
  [IO.File]::WriteAllText($profile, "EC10_WEB_BRIDGE_SECRET=$secret`r`n", [Text.UTF8Encoding]::new($false))
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Ponte local EC10 entre WhatsApp Web, Gustavo e CRM.' -Force | Out-Null

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*run-whatsapp-web-bridge.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-ScheduledTask -TaskName $taskName

$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Status Gustavo EC10.url'
[IO.File]::WriteAllText($desktopLink, "[InternetShortcut]`r`nURL=http://127.0.0.1:3219/`r`n", [Text.UTF8Encoding]::new($false))

Write-Output "installed:$taskName"
