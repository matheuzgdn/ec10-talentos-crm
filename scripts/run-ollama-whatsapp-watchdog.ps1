$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot "runtime\automation-logs"
$logPath = Join-Path $logDir "ollama-whatsapp-watchdog.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location $projectRoot

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] starting ollama whatsapp watchdog" | Tee-Object -FilePath $logPath -Append

try {
  node scripts\audit-bot-integrity.mjs --apply --since="15 minutes" 2>&1 | Tee-Object -FilePath $logPath -Append
  node scripts\ollama-whatsapp-watchdog.mjs --apply --limit 20 2>&1 | Tee-Object -FilePath $logPath -Append
  $exitCode = $LASTEXITCODE
  $finishedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$finishedAt] finished with exit code $exitCode" | Tee-Object -FilePath $logPath -Append
  exit $exitCode
} catch {
  $failedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$failedAt] failed: $($_.Exception.Message)" | Tee-Object -FilePath $logPath -Append
  exit 1
}
