param(
  [string]$OracleHost = '147.15.27.235',
  [string]$OracleUser = 'opc',
  [string]$SshKey = 'C:\Users\Admin\.ssh\oracle_whatsapp_crm',
  [string]$RemoteEnvPath = '/etc/ec10-gustavo-v2.env'
)

$ErrorActionPreference = 'Stop'

function Set-LineValue {
  param([System.Collections.Generic.List[string]]$Lines, [string]$Key, [string]$Value)
  $replacement = "$Key=$Value"
  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index] -match "^$([regex]::Escape($Key))=") {
      $Lines[$index] = $replacement
      return
    }
  }
  $Lines.Add($replacement)
}

. 'C:\Users\Admin\.codex\shared-access\scripts\load-codex-profile.ps1' -Profile ec10-manager

if ($env:META_SYSTEM_USER_ACCESS_TOKEN.Length -lt 100) {
  throw 'Token permanente da Meta ausente no cofre local.'
}
if ($env:META_WABA_ID -ne '942546618420188') {
  throw 'O WABA ativo no cofre não é o WABA EC10 aprovado.'
}
if ($env:META_PHONE_NUMBER_ID.Length -lt 10) {
  throw 'O identificador do número oficial EC10 ainda não foi salvo no cofre local.'
}

$target = "$OracleUser@$OracleHost"
$existing = & ssh -i $SshKey -o BatchMode=yes -o StrictHostKeyChecking=accept-new $target "sudo cat '$RemoteEnvPath'"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível ler a configuração protegida do Oracle.' }

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in @($existing)) { $lines.Add([string]$line) }

Set-LineValue -Lines $lines -Key 'META_GRAPH_VERSION' -Value 'v25.0'
Set-LineValue -Lines $lines -Key 'META_WABA_ID' -Value $env:META_WABA_ID
Set-LineValue -Lines $lines -Key 'META_PHONE_NUMBER_ID' -Value $env:META_PHONE_NUMBER_ID
Set-LineValue -Lines $lines -Key 'META_WHATSAPP_ACCESS_TOKEN' -Value $env:META_SYSTEM_USER_ACCESS_TOKEN
Set-LineValue -Lines $lines -Key 'META_APP_SECRET' -Value $env:META_APP_SECRET
Set-LineValue -Lines $lines -Key 'META_WHATSAPP_VERIFY_TOKEN' -Value $env:META_VERIFY_TOKEN
Set-LineValue -Lines $lines -Key 'GUSTAVO_V2_ENABLED' -Value 'false'

$content = (($lines -join "`n") + "`n")
$content | & ssh -i $SshKey -o BatchMode=yes $target "sudo sh -c 'umask 077; cat > $RemoteEnvPath.tmp; chown root:root $RemoteEnvPath.tmp; chmod 600 $RemoteEnvPath.tmp; mv $RemoteEnvPath.tmp $RemoteEnvPath'"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível atualizar a configuração protegida do Oracle.' }

& ssh -i $SshKey -o BatchMode=yes $target "sudo systemctl restart gustavo-v2.service"
if ($LASTEXITCODE -ne 0) { throw 'O serviço Gustavo V2 não reiniciou corretamente.' }

$health = $null
for ($attempt = 1; $attempt -le 8; $attempt++) {
  $health = & ssh -i $SshKey -o BatchMode=yes $target "curl -fsS http://127.0.0.1:8781/health 2>/dev/null"
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}
if (-not $health) { throw 'O healthcheck do Gustavo V2 falhou após a atualização.' }

[pscustomobject]@{
  synced = $true
  correct_waba = $env:META_WABA_ID
  phone_configured = $true
  gustavo_enabled = $false
  health = ($health | ConvertFrom-Json)
} | ConvertTo-Json -Depth 6
