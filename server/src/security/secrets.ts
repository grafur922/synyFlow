import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type SystemSecretName = 'xiaomiCloudCookie' | 'dataEncryptionKey' | 'historyEncryptionKey' | 'apiToken'

type WindowsSecretFile = {
  format: 'terra-windows-secrets'
  version: 1
  secrets: Partial<Record<SystemSecretName, string>>
}

type SecretCommandOptions = {
  encoding: 'utf8'
  stdio: ['ignore', 'pipe', 'pipe']
  timeout: number
  maxBuffer: number
  windowsHide: boolean
}

export type SecretCommandRunner = (file: string, args: string[], options: SecretCommandOptions) => string

const DEFAULT_MACOS_KEYCHAIN_SERVICE = 'app.terra-hub.server'
const MACOS_SECURITY_PATH = '/usr/bin/security'
const secretCache = new Map<SystemSecretName, string>()
let secretFileCache: WindowsSecretFile | undefined
let secretFileLoaded = false

export function getXiaomiCloudCookie() {
  return firstEnvironmentValue('XIAOMI_CLOUD_COOKIE') || getSystemSecret('xiaomiCloudCookie')
}

export function getHistoryEncryptionSecret() {
  return firstEnvironmentValue('TERRA_HISTORY_ENCRYPTION_KEY')
    || firstEnvironmentValue('TERRA_DATA_ENCRYPTION_KEY')
    || getSystemSecret('historyEncryptionKey')
    || getSystemSecret('dataEncryptionKey')
}

export function getDataEncryptionSecret() {
  return firstEnvironmentValue('TERRA_DATA_ENCRYPTION_KEY')
    || getSystemSecret('dataEncryptionKey')
    || getHistoryEncryptionSecret()
}

export function getApiToken() {
  return firstEnvironmentValue('TERRA_API_TOKEN') || getSystemSecret('apiToken')
}

export function getSecretConfigurationStatus() {
  const filePath = getWindowsSecretFilePath()
  return {
    windowsDpapiSupported: process.platform === 'win32',
    windowsSecretFileConfigured: process.platform === 'win32' && existsSync(filePath),
    macosKeychainSupported: process.platform === 'darwin',
    systemProvider: process.platform === 'win32' ? 'windows-dpapi' : process.platform === 'darwin' ? 'macos-keychain' : 'none',
    environment: {
      xiaomiCookie: Boolean(firstEnvironmentValue('XIAOMI_CLOUD_COOKIE')),
      dataEncryptionKey: Boolean(firstEnvironmentValue('TERRA_DATA_ENCRYPTION_KEY')),
      historyEncryptionKey: Boolean(firstEnvironmentValue('TERRA_HISTORY_ENCRYPTION_KEY')),
      apiToken: Boolean(firstEnvironmentValue('TERRA_API_TOKEN'))
    }
  }
}

function getSystemSecret(name: SystemSecretName) {
  if (secretCache.has(name)) return secretCache.get(name) || ''
  let value = ''
  if (process.platform === 'win32') value = getWindowsSecret(name)
  else if (process.platform === 'darwin') value = createMacosKeychainSecretReader(defaultSecretCommandRunner)(name)
  secretCache.set(name, value)
  return value
}

function firstEnvironmentValue(name: string) {
  return (process.env[name] || '').trim()
}

function getWindowsSecret(name: SystemSecretName) {
  if (process.platform !== 'win32') return ''
  const file = readWindowsSecretFile()
  const encrypted = file?.secrets[name]
  if (!encrypted) return ''

  try {
    const filePath = escapePowerShellLiteral(getWindowsSecretFilePath())
    const field = escapePowerShellLiteral(name)
    const script = [
      `$payload = Get-Content -LiteralPath '${filePath}' -Raw | ConvertFrom-Json`,
      `$encrypted = $payload.secrets.'${field}'`,
      '$secure = ConvertTo-SecureString $encrypted',
      '$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
      'try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }',
      'finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'
    ].join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      maxBuffer: 64 * 1024,
      windowsHide: true
    }).trim()
    return value
  } catch {
    throw new Error(`Windows DPAPI secret '${name}' could not be decrypted for the current user`)
  }
}

export function createMacosKeychainSecretReader(
  run: SecretCommandRunner,
  service = getMacosKeychainService()
) {
  const normalizedService = normalizeMacosKeychainService(service)
  return (name: SystemSecretName) => {
    try {
      return run(MACOS_SECURITY_PATH, [
        'find-generic-password',
        '-a', name,
        '-s', normalizedService,
        '-w'
      ], secretCommandOptions()).trim()
    } catch (cause) {
      if (isMacosItemNotFound(cause)) return ''
      throw new Error(`macOS Keychain secret '${name}' could not be read for the current user`)
    }
  }
}

function readWindowsSecretFile() {
  if (secretFileLoaded) return secretFileCache
  secretFileLoaded = true
  const filePath = getWindowsSecretFilePath()
  if (!existsSync(filePath)) return undefined
  try {
    const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
    if (Buffer.byteLength(raw, 'utf8') > 1_000_000) throw new Error('Secret file is too large')
    const parsed = JSON.parse(raw) as Partial<WindowsSecretFile>
    if (parsed.format !== 'terra-windows-secrets' || parsed.version !== 1 || !parsed.secrets || typeof parsed.secrets !== 'object' || Array.isArray(parsed.secrets)) {
      throw new Error('Invalid secret file format')
    }
    secretFileCache = parsed as WindowsSecretFile
    return secretFileCache
  } catch {
    throw new Error('Windows DPAPI secret file is invalid or unreadable')
  }
}

function getWindowsSecretFilePath() {
  return resolve(process.env.TERRA_WINDOWS_SECRETS_FILE || join(process.cwd(), '.terra-secrets.json'))
}

function getMacosKeychainService() {
  return process.env.TERRA_MACOS_KEYCHAIN_SERVICE || DEFAULT_MACOS_KEYCHAIN_SERVICE
}

function normalizeMacosKeychainService(value: string) {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || /[\0-\x1f\x7f]/.test(normalized)) {
    throw new Error('TERRA_MACOS_KEYCHAIN_SERVICE is invalid')
  }
  return normalized
}

function isMacosItemNotFound(cause: unknown) {
  return typeof cause === 'object' && cause !== null && 'status' in cause && (cause as { status?: unknown }).status === 44
}

function secretCommandOptions(): SecretCommandOptions {
  return {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    maxBuffer: 64 * 1024,
    windowsHide: true
  }
}

const defaultSecretCommandRunner: SecretCommandRunner = (file, args, options) => execFileSync(file, args, options)

function escapePowerShellLiteral(value: string) {
  return value.replace(/'/g, "''")
}
