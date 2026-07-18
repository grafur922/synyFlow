const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { execFileSync } = require('node:child_process')

const secrets = require('../dist/security/secrets')
const macCalls = []
const macReader = secrets.createMacosKeychainSecretReader((file, args, options) => {
  macCalls.push({ file, args, options })
  return 'mock-keychain-value\n'
}, 'app.terra-hub.test')
if (macReader('apiToken') !== 'mock-keychain-value') throw new Error('macOS Keychain result was not normalized')
if (macCalls.length !== 1 || macCalls[0].file !== '/usr/bin/security') throw new Error('macOS Keychain did not use the fixed security executable')
if (JSON.stringify(macCalls[0].args) !== JSON.stringify(['find-generic-password', '-a', 'apiToken', '-s', 'app.terra-hub.test', '-w'])) throw new Error('macOS Keychain arguments changed')
if ('shell' in macCalls[0].options) throw new Error('macOS Keychain command unexpectedly enabled a shell')

const missingReader = secrets.createMacosKeychainSecretReader(() => { throw Object.assign(new Error('not found'), { status: 44 }) })
if (missingReader('dataEncryptionKey') !== '') throw new Error('Missing macOS Keychain item did not resolve as unconfigured')
try {
  secrets.createMacosKeychainSecretReader(() => { throw Object.assign(new Error('private stderr'), { status: 1 }) })('xiaomiCloudCookie')
  throw new Error('Expected macOS Keychain access failure')
} catch (error) {
  if (!error.message.includes('could not be read') || error.message.includes('private stderr')) throw error
}

if (process.platform !== 'win32') {
  console.log(JSON.stringify({ macosCommandBoundary: true, windowsDpapiSkipped: true, reason: 'Windows DPAPI is not available' }))
  process.exit(0)
}

const root = resolve(mkdtempSync(join(tmpdir(), 'terra-secrets-smoke-')))
const secretPath = join(root, 'secrets.json')
const dataKey = 'dpapi-data-key-for-terra-tests-32'
const cookie = 'serviceToken=dpapi-test-token-value; userId=local-test'

try {
  const escapedPath = secretPath.replace(/'/g, "''")
  const escapedKey = dataKey.replace(/'/g, "''")
  const escapedCookie = cookie.replace(/'/g, "''")
  const script = [
    `$key = ConvertTo-SecureString '${escapedKey}' -AsPlainText -Force | ConvertFrom-SecureString`,
    `$cookie = ConvertTo-SecureString '${escapedCookie}' -AsPlainText -Force | ConvertFrom-SecureString`,
    `$payload = @{ format = 'terra-windows-secrets'; version = 1; secrets = @{ dataEncryptionKey = $key; xiaomiCloudCookie = $cookie } } | ConvertTo-Json -Depth 5`,
    `[IO.File]::WriteAllText('${escapedPath}', $payload, [Text.UTF8Encoding]::new($false))`
  ].join('; ')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { stdio: 'ignore', timeout: 10_000, windowsHide: true })

  const raw = readFileSync(secretPath, 'utf8')
  if (raw.includes(dataKey) || raw.includes(cookie)) throw new Error('DPAPI file contains plaintext')
  process.env.TERRA_WINDOWS_SECRETS_FILE = secretPath
  delete process.env.TERRA_DATA_ENCRYPTION_KEY
  delete process.env.XIAOMI_CLOUD_COOKIE
  if (secrets.getDataEncryptionSecret() !== dataKey || secrets.getXiaomiCloudCookie() !== cookie) throw new Error('DPAPI round trip failed')
  if (secrets.getHistoryEncryptionSecret() !== dataKey) throw new Error('History did not fall back to the DPAPI data key')
  process.env.TERRA_DATA_ENCRYPTION_KEY = 'environment-priority-key-32-value'
  if (secrets.getDataEncryptionSecret() !== 'environment-priority-key-32-value') throw new Error('Environment priority failed')
  if (secrets.getHistoryEncryptionSecret() !== 'environment-priority-key-32-value') throw new Error('History did not fall back to the environment data key')
  process.env.TERRA_HISTORY_ENCRYPTION_KEY = 'explicit-history-key-32-value-test'
  if (secrets.getHistoryEncryptionSecret() !== 'explicit-history-key-32-value-test') throw new Error('Explicit history key did not take priority')

  console.log(JSON.stringify({ macosCommandBoundary: true, dpapiEncrypted: true, roundTrip: true, environmentPriority: true, historyDataKeyFallback: true, plaintextLeaked: false }, null, 2))
} finally {
  const tempBase = resolve(tmpdir())
  if ((root.startsWith(`${tempBase}\\`) || root.startsWith(`${tempBase}/`)) && basename(root).startsWith('terra-secrets-smoke-')) rmSync(root, { recursive: true, force: true })
}
