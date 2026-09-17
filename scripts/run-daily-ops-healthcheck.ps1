$ErrorActionPreference = 'Stop'

. C:\Users\Admin\.codex\shared-access\scripts\load-codex-profile.ps1 -Profile ec10-manager | Out-Null
. C:\Users\Admin\.codex\shared-access\scripts\load-codex-profile.ps1 -Profile cliente-whatsapp-crm-supabase | Out-Null

$env:MEETING_REMINDER_LEAD_MINUTES = '10'
$project = 'C:\Users\Admin\Documents\cliente-whatsapp-crm'
$logDir = Join-Path $project 'runtime\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $logDir "daily-ops-healthcheck-$stamp.log"

Push-Location $project
try {
  node scripts\backfill-schedule-capi.mjs | Tee-Object -FilePath $logPath
  node scripts\retry-failed-capi-events.mjs | Tee-Object -FilePath $logPath -Append
  node scripts\google-meet-open-access.mjs | Tee-Object -FilePath $logPath -Append
  node scripts\backfill-meeting-reminders.mjs | Tee-Object -FilePath $logPath -Append
  node scripts\enqueue-ec10-followups.mjs | Tee-Object -FilePath $logPath -Append
  node scripts\repair-ec10-followups.mjs | Tee-Object -FilePath $logPath -Append
  node scripts\daily-ops-healthcheck.mjs | Tee-Object -FilePath $logPath -Append
  node scripts\audit-traffic-ec10.mjs | Tee-Object -FilePath $logPath -Append
} finally {
  Pop-Location
}
