param(
  [string]$GraphVersion = 'v25.0',
  [string]$CorrectWabaId = '942546618420188',
  [string]$WrongWabaId = '1198168408304439',
  [string]$PhoneLast4 = '6146',
  [string]$ProfilePath = 'C:\Users\Admin\.codex\shared-access\secrets\ec10-manager.env'
)

$ErrorActionPreference = 'Stop'

function Set-EnvValues {
  param([string]$Path, [hashtable]$Values)
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) { $lines.Add($line) }
  foreach ($key in $Values.Keys) {
    $replacement = "$key=$($Values[$key])"
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
      if ($lines[$index] -match "^$([regex]::Escape($key))=") {
        $lines[$index] = $replacement
        $found = $true
        break
      }
    }
    if (-not $found) { $lines.Add($replacement) }
  }
  $temporaryPath = "$Path.tmp"
  [System.IO.File]::WriteAllLines($temporaryPath, $lines, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

. 'C:\Users\Admin\.codex\shared-access\scripts\load-codex-profile.ps1' -Profile ec10-manager
$headers = @{ Authorization = "Bearer $env:META_SYSTEM_USER_ACCESS_TOKEN" }
$base = "https://graph.facebook.com/$GraphVersion"

$rollback = Invoke-RestMethod -Method Delete -Uri "$base/$WrongWabaId/subscribed_apps" -Headers $headers
$remaining = Invoke-RestMethod -Method Get -Uri "$base/$WrongWabaId/subscribed_apps" -Headers $headers
$correctWaba = Invoke-RestMethod -Method Get -Uri "$base/$CorrectWabaId`?fields=id,name" -Headers $headers
$correctPhones = Invoke-RestMethod -Method Get -Uri "$base/$CorrectWabaId/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status,name_status" -Headers $headers
$selectedPhone = @($correctPhones.data | Where-Object { (($_.display_phone_number -replace '\D', '') -like "*$PhoneLast4") } | Select-Object -First 1)
if (-not $selectedPhone) { throw "O número EC10 terminado em $PhoneLast4 não foi encontrado no WABA correto." }
$subscription = Invoke-RestMethod -Method Post -Uri "$base/$CorrectWabaId/subscribed_apps" -Headers $headers
$subscribedApps = Invoke-RestMethod -Method Get -Uri "$base/$CorrectWabaId/subscribed_apps" -Headers $headers
$apiStatus = if ($selectedPhone.code_verification_status -eq 'VERIFIED' -and $selectedPhone.status -eq 'CONNECTED') {
  'official_cloud_api_ready_for_test'
} else {
  'official_cloud_api_phone_found_waiting_verification'
}

Set-EnvValues -Path $ProfilePath -Values @{
  META_WABA_ID = $CorrectWabaId
  META_PHONE_NUMBER_ID = [string]$selectedPhone.id
  META_WABA_PRIMARY_CANDIDATE_ID = $CorrectWabaId
  META_WABA_PRIMARY_CANDIDATE_NAME = [string]$correctWaba.name
  META_WHATSAPP_API_STATUS = $apiStatus
  META_GRAPH_API_VERSION = $GraphVersion
}

[pscustomobject]@{
  rollback_success = [bool]$rollback.success
  wrong_waba_remaining_subscriptions = @($remaining.data).Count
  correct_waba_id = [string]$correctWaba.id
  correct_waba_name = [string]$correctWaba.name
  correct_waba_phone_count = @($correctPhones.data).Count
  selected_phone_last4 = $PhoneLast4
  selected_phone_status = [string]$selectedPhone.status
  selected_phone_code_verification = [string]$selectedPhone.code_verification_status
  subscription_success = [bool]$subscription.success
  subscribed_apps = @($subscribedApps.data).Count
  api_status = $apiStatus
  profile_repaired = $true
} | ConvertTo-Json -Depth 5
