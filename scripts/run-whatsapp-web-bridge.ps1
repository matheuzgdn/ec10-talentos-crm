param([switch]$Once)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$loader = 'C:\Users\Admin\.codex\shared-access\scripts\load-codex-profile.ps1'
$bridgeProfile = 'C:\Users\Admin\.codex\shared-access\secrets\ec10-whatsapp-web-bridge.env'
$sshKey = 'C:\Users\Admin\.ssh\oracle_whatsapp_crm'
$logDirectory = Join-Path $repository '.runtime\whatsapp-web-bridge\logs'
$pidFile = Join-Path $repository '.runtime\whatsapp-web-bridge\runner.pid'

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii

. $loader -Profile ec10-saas-supabase
if (-not (Test-Path -LiteralPath $bridgeProfile)) {
  throw 'Perfil privado ec10-whatsapp-web-bridge ainda não foi criado.'
}

Get-Content -LiteralPath $bridgeProfile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
    $name, $value = $line.Split('=', 2)
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim().Trim('"').Trim("'"), 'Process')
  }
}

$env:GUSTAVO_V2_LOCAL_URL = 'http://127.0.0.1:8781'
$env:EC10_WEB_BRIDGE_PORT = '3219'
$tunnel = $null
$bridge = $null

function Start-OracleTunnel {
  $arguments = @(
    '-N', '-T', '-i', $sshKey,
    '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
    '-L', '127.0.0.1:8781:127.0.0.1:8781',
    'opc@147.15.27.235'
  )
  return Start-Process -FilePath 'ssh.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
}

function Start-Bridge {
  return Start-Process -FilePath 'node.exe' -ArgumentList @('apps\whatsapp-web-bridge\src\server.mjs') `
    -WorkingDirectory $repository -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDirectory 'bridge.out.log') `
    -RedirectStandardError (Join-Path $logDirectory 'bridge.error.log')
}

try {
  while ($true) {
    if (-not $tunnel -or $tunnel.HasExited) {
      $tunnel = Start-OracleTunnel
      Start-Sleep -Seconds 2
    }
    if (-not $bridge -or $bridge.HasExited) {
      $bridge = Start-Bridge
      Start-Sleep -Seconds 2
    }
    if ($Once) { break }
    Start-Sleep -Seconds 5
  }
}
finally {
  if (-not $Once) {
    if ($bridge -and -not $bridge.HasExited) { Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue }
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
}
