param(
  [string]$BusinessId = '1620753555015073',
  [string]$PreferredWabaId = '942546618420188',
  [string]$GraphVersion = 'v25.0',
  [string]$ProfilePath = 'C:\Users\Admin\.codex\shared-access\secrets\ec10-manager.env',
  [int]$ListenPort = 0
)

$ErrorActionPreference = 'Stop'

function Invoke-MetaGet {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][hashtable]$Headers)
  Invoke-RestMethod -Method Get -Uri "https://graph.facebook.com/$GraphVersion/$Path" -Headers $Headers
}

function Set-EnvValues {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][hashtable]$Values
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw 'Perfil compartilhado ec10-manager não encontrado.'
  }

  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    $lines.Add($line)
  }

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
    if (-not $found) {
      $lines.Add($replacement)
    }
  }

  $temporaryPath = "$Path.tmp"
  [System.IO.File]::WriteAllLines($temporaryPath, $lines, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

$token = ''
try {
  if ($ListenPort -gt 0) {
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://127.0.0.1:$ListenPort/")
    $listener.Start()
    try {
      while (-not $token) {
        $context = $listener.GetContext()
        if ($context.Request.HttpMethod -eq 'GET') {
          $html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>EC10 Cofre Local</title></head><body><main><h1>EC10 — cofre local</h1><form method="post"><label for="token">Token temporário</label><textarea id="token" name="token" autocomplete="off"></textarea><button type="submit">Armazenar com segurança</button></form></main></body></html>'
          $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
          $context.Response.ContentType = 'text/html; charset=utf-8'
          $context.Response.ContentLength64 = $bytes.Length
          $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
          $context.Response.Close()
          continue
        }

        $reader = [System.IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
        try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($context.Request.ContentType -like 'application/x-www-form-urlencoded*') {
          $encoded = ($body -split '&' | Where-Object { $_ -like 'token=*' } | Select-Object -First 1) -replace '^token=', ''
          $token = [System.Net.WebUtility]::UrlDecode($encoded).Trim()
        } else {
          $token = $body.Trim()
        }
        $responseHtml = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>EC10 Cofre Local</title></head><body><p>Recebido. A validação continua no servidor local.</p></body></html>'
        $responseBytes = [System.Text.Encoding]::UTF8.GetBytes($responseHtml)
        $context.Response.ContentType = 'text/html; charset=utf-8'
        $context.Response.ContentLength64 = $responseBytes.Length
        $context.Response.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
        $context.Response.Close()
      }
    } finally {
      $listener.Stop()
      $listener.Close()
    }
  } else {
    $token = (Get-Clipboard -Raw).Trim()
  }
  if ($token.Length -lt 100 -or $token -match '\s') {
    throw 'O token permanente não foi recebido com segurança.'
  }

  $headers = @{ Authorization = "Bearer $token" }
  $identity = Invoke-MetaGet -Path 'me?fields=id,name' -Headers $headers

  Set-EnvValues -Path $ProfilePath -Values @{
    META_SYSTEM_USER_ACCESS_TOKEN = $token
    META_WHATSAPP_ACCESS_TOKEN = $token
    META_SYSTEM_USER_ACCESS_TOKEN_SOURCE = 'meta_system_user_ec10ia_permanent_2026-09-18'
    META_SYSTEM_USER_ACCESS_TOKEN_EXPIRES_AT = 'never'
  }

  $wabas = [System.Collections.Generic.List[object]]::new()
  foreach ($path in @(
      "$BusinessId/owned_whatsapp_business_accounts?fields=id,name,currency,timezone_id",
      "$BusinessId/client_whatsapp_business_accounts?fields=id,name,currency,timezone_id"
    )) {
    try {
      $response = Invoke-MetaGet -Path $path -Headers $headers
      foreach ($item in @($response.data)) {
        if ($item.id -and -not ($wabas | Where-Object id -eq $item.id)) {
          $wabas.Add($item)
        }
      }
    } catch {
      # Alguns tokens só enxergam o WABA atribuído diretamente ao usuário do sistema.
    }
  }

  if (-not ($wabas | Where-Object id -eq $PreferredWabaId)) {
    try {
      $preferred = Invoke-MetaGet -Path "$PreferredWabaId`?fields=id,name,currency,timezone_id" -Headers $headers
      if ($preferred.id) { $wabas.Add($preferred) }
    } catch {
      # O diagnóstico abaixo informará caso nenhum WABA esteja acessível.
    }
  }

  if ($wabas.Count -eq 0) {
    $permissions = Invoke-MetaGet -Path 'me/permissions' -Headers $headers
    [pscustomobject]@{
      ok = $false
      token_valid = $true
      system_user_id = [string]$identity.id
      permissions = @($permissions.data | ForEach-Object { [pscustomobject]@{ permission = [string]$_.permission; status = [string]$_.status } })
      profile_updated = $true
      error = 'O token foi aceito, mas nenhum WhatsApp Business Account atribuído ficou acessível.'
    } | ConvertTo-Json -Depth 6
    exit 3
  }

  $phoneRecords = [System.Collections.Generic.List[object]]::new()
  foreach ($waba in $wabas) {
    try {
      $phones = Invoke-MetaGet -Path "$($waba.id)/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status,code_verification_status,name_status" -Headers $headers
      foreach ($phone in @($phones.data)) {
        $phoneRecords.Add([pscustomobject]@{
            waba_id = [string]$waba.id
            waba_name = [string]$waba.name
            phone_id = [string]$phone.id
            display_phone_number = [string]$phone.display_phone_number
            verified_name = [string]$phone.verified_name
            status = [string]$phone.status
            code_verification_status = [string]$phone.code_verification_status
            quality_rating = [string]$phone.quality_rating
            name_status = [string]$phone.name_status
          })
      }
    } catch {
      # Mantém o WABA no diagnóstico mesmo se ainda não houver número associado.
    }
  }

  $selectedPhone = $phoneRecords |
    Where-Object waba_id -eq $PreferredWabaId |
    Sort-Object @{ Expression = { if ($_.code_verification_status -eq 'VERIFIED') { 0 } else { 1 } } } |
    Select-Object -First 1

  if (-not $selectedPhone) {
    $summary = [pscustomobject]@{
      ok = $false
      token_valid = $true
      system_user_id = [string]$identity.id
      wabas = @($wabas | ForEach-Object { [pscustomobject]@{ id = [string]$_.id; name = [string]$_.name } })
      phones = @($phoneRecords | ForEach-Object { [pscustomobject]@{ waba_id = $_.waba_id; phone_id = $_.phone_id; display_phone_number = $_.display_phone_number; status = $_.status; code_verification_status = $_.code_verification_status } })
      next_action = "O WABA EC10 $PreferredWabaId existe, mas ainda não possui número. Nenhum telefone de outro WABA foi selecionado."
    }
    $summary | ConvertTo-Json -Depth 6
    exit 2
  }

  $selectedWabaId = [string]$selectedPhone.waba_id
  $subscription = Invoke-RestMethod -Method Post -Uri "https://graph.facebook.com/$GraphVersion/$selectedWabaId/subscribed_apps" -Headers $headers
  $subscribedApps = Invoke-MetaGet -Path "$selectedWabaId/subscribed_apps" -Headers $headers

  Set-EnvValues -Path $ProfilePath -Values @{
    META_SYSTEM_USER_ACCESS_TOKEN = $token
    META_WHATSAPP_ACCESS_TOKEN = $token
    META_WABA_ID = $selectedWabaId
    META_PHONE_NUMBER_ID = [string]$selectedPhone.phone_id
    META_WABA_IDS_FOUND = (($wabas | ForEach-Object { $_.id }) -join ',')
    META_WABA_PRIMARY_CANDIDATE_ID = $selectedWabaId
    META_WABA_PRIMARY_CANDIDATE_NAME = [string]$selectedPhone.waba_name
    META_WHATSAPP_API_STATUS = 'official_cloud_api_token_and_phone_confirmed'
    META_SYSTEM_USER_ACCESS_TOKEN_SOURCE = 'meta_system_user_ec10ia_permanent_2026-09-18'
    META_SYSTEM_USER_ACCESS_TOKEN_EXPIRES_AT = 'never'
  }

  [pscustomobject]@{
    ok = $true
    token_valid = $true
    system_user_id = [string]$identity.id
    selected = $selectedPhone
    wabas = @($wabas | ForEach-Object { [pscustomobject]@{ id = [string]$_.id; name = [string]$_.name } })
    subscribed = [bool]$subscription.success
    subscribed_apps = @($subscribedApps.data | ForEach-Object {
        $app = $_.whatsapp_business_api_data
        [pscustomobject]@{ id = [string]$app.id; name = [string]$app.name }
      })
    profile_updated = $true
  } | ConvertTo-Json -Depth 7
} catch {
  [pscustomobject]@{
    ok = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Depth 4
  exit 1
} finally {
  if ($ListenPort -le 0) {
    Set-Clipboard -Value 'EC10: token armazenado com segurança'
  }
  $token = $null
}
