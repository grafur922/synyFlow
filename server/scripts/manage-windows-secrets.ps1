param(
  [ValidateSet('set', 'set-stdin', 'remove', 'list')]
  [string]$Action = 'list',
  [ValidateSet('xiaomiCloudCookie', 'xiaomiPassportRefreshCredentials', 'aliyunEmbeddingApiKey', 'dataEncryptionKey', 'historyEncryptionKey', 'apiToken')]
  [string]$Name = 'xiaomiCloudCookie'
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  throw 'Windows DPAPI secrets are available only on Windows.'
}

$path = if ($env:TERRA_WINDOWS_SECRETS_FILE) {
  [IO.Path]::GetFullPath($env:TERRA_WINDOWS_SECRETS_FILE)
} else {
  [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.terra-secrets.json'))
}

$payload = if (Test-Path -LiteralPath $path) {
  Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{ format = 'terra-windows-secrets'; version = 1; secrets = [pscustomobject]@{} }
}

if ($payload.format -ne 'terra-windows-secrets' -or $payload.version -ne 1) {
  throw 'The configured secret file has an unsupported format.'
}

if ($Action -eq 'list') {
  $payload.secrets.PSObject.Properties.Name | Sort-Object
  exit 0
}

if ($Action -eq 'set' -or $Action -eq 'set-stdin') {
  if ($Action -eq 'set-stdin') {
    $plain = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrEmpty($plain)) { throw 'Secret value is empty.' }
    $secure = ConvertTo-SecureString $plain -AsPlainText -Force
    $plain = $null
  } else {
    $secure = Read-Host "Enter $Name" -AsSecureString
  }
  $encrypted = ConvertFrom-SecureString $secure
  if ($payload.secrets.PSObject.Properties.Name -contains $Name) {
    $payload.secrets.$Name = $encrypted
  } else {
    $payload.secrets | Add-Member -NotePropertyName $Name -NotePropertyValue $encrypted
  }
} else {
  if ($payload.secrets.PSObject.Properties.Name -contains $Name) {
    $payload.secrets.PSObject.Properties.Remove($Name)
  }
}

$directory = Split-Path -Parent $path
[IO.Directory]::CreateDirectory($directory) | Out-Null
$tempPath = "$path.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
try {
  $json = $payload | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText($tempPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetOwner([Security.Principal.NTAccount]$identity)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $tempPath -AclObject $acl
  Move-Item -LiteralPath $tempPath -Destination $path -Force
} finally {
  if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
}
Write-Output "$Action completed for $Name"
