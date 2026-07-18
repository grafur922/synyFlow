require('reflect-metadata')

const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')

async function main() {
  if (process.platform !== 'win32') {
    console.log(JSON.stringify({ windowsDpapiSkipped: true, reason: 'Windows DPAPI is not available' }))
    return
  }

  const root = resolve(mkdtempSync(join(tmpdir(), 'terra-xiaomi-credentials-')))
  const secretPath = join(root, 'secrets.json')
  const firstCookie = 'serviceToken=ui-dpapi-token-value-32; userId=local-user; deviceId=terra-test'
  const environmentCookie = 'serviceToken=environment-token-value-32; userId=environment-user'
  const dataKey = 'preserved-data-key-value-32-characters'

  process.env.TERRA_WINDOWS_SECRETS_FILE = secretPath
  delete process.env.XIAOMI_CLOUD_COOKIE

  const secrets = require('../dist/security/secrets')
  secrets.invalidateSystemSecretCache()
  secrets.setWindowsSystemSecret('dataEncryptionKey', dataKey)
  const { XiaomiNotesService } = require('../dist/xiaomi-notes/xiaomi-notes.service')
  const { XiaomiNotesController } = require('../dist/xiaomi-notes/xiaomi-notes.controller')
  const history = {
    getStorageStatus: () => ({
      available: true,
      encryptedAtRest: true,
      encryptionConfigured: true,
      migrationPending: false,
      format: 'sqlite',
      message: 'test'
    })
  }

  try {
    const service = new XiaomiNotesService(history)
    const initial = service.getStatus()
    assert(initial.mode === 'unconfigured' && initial.credentialSource === 'none' && initial.credentialWritable, 'Unconfigured DPAPI status is incorrect')

    await expectStatus(() => service.saveCredentials({ cookie: 'userId=missing-token' }), 400)
    const saved = service.saveCredentials({ cookie: firstCookie })
    assert(saved.configured && saved.mode === 'ready', 'Saved credential did not configure the running connector')
    assert(saved.credentialSource === 'windows-dpapi' && saved.credentialWritable, 'DPAPI credential source metadata is incorrect')

    const raw = readFileSync(secretPath, 'utf8')
    assert(!raw.includes(firstCookie) && !raw.includes('ui-dpapi-token-value-32'), 'DPAPI file contains plaintext credential material')
    assert(secrets.getXiaomiCloudCookie() === firstCookie, 'Saved DPAPI Cookie was not available after cache invalidation')
    assert(secrets.getDataEncryptionSecret() === dataKey, 'Saving the Cookie replaced an unrelated DPAPI secret')
    assert(!JSON.stringify(saved).includes(firstCookie) && !JSON.stringify(saved).includes('ui-dpapi-token-value-32'), 'Credential leaked through connector status')

    const controller = new XiaomiNotesController({ saveCredentials: () => ({ redacted: true }) }, {})
    const localResult = controller.saveCredentials({ cookie: firstCookie }, { socket: { remoteAddress: '127.0.0.1' } })
    assert(localResult.redacted === true, 'Loopback credential request was not accepted')
    await expectStatus(() => controller.saveCredentials({ cookie: firstCookie }, { socket: { remoteAddress: '192.0.2.10' } }), 403)

    process.env.XIAOMI_CLOUD_COOKIE = environmentCookie
    const environmentService = new XiaomiNotesService(history)
    const environmentStatus = environmentService.getStatus()
    assert(environmentStatus.credentialSource === 'environment' && !environmentStatus.credentialWritable, 'Environment credential priority status is incorrect')
    await expectStatus(() => environmentService.saveCredentials({ cookie: firstCookie }), 409)
    assert(secrets.getXiaomiCloudCookie() === environmentCookie, 'Environment Cookie did not retain priority')

    console.log(JSON.stringify({
      manualEntryAvailable: true,
      malformedCookieRejected: true,
      dpapiEncrypted: true,
      hotReloaded: true,
      statusRedacted: true,
      environmentPriority: true,
      environmentOverrideRejected: true,
      unrelatedSecretsPreserved: true,
      remoteSubmissionRejected: true
    }, null, 2))
  } finally {
    delete process.env.XIAOMI_CLOUD_COOKIE
    delete process.env.TERRA_WINDOWS_SECRETS_FILE
    secrets.invalidateSystemSecretCache()
    const tempBase = resolve(tmpdir())
    if ((root.startsWith(`${tempBase}\\`) || root.startsWith(`${tempBase}/`)) && basename(root).startsWith('terra-xiaomi-credentials-')) {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectStatus(work, status) {
  try {
    await work()
  } catch (error) {
    if (typeof error?.getStatus === 'function' && error.getStatus() === status) return
    throw error
  }
  throw new Error(`Expected HTTP exception ${status}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
