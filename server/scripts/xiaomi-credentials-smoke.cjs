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
  const refreshCredentials = { passToken: 'pass-token-test-value', userId: '10001', cUserId: 'c-user-test', deviceId: 'device-test' }

  process.env.TERRA_WINDOWS_SECRETS_FILE = secretPath
  process.env.XIAOMI_CLOUD_COOKIE = '本人 i.mi.com 会话的完整 Cookie'

  const secrets = require('../dist/security/secrets')
  secrets.invalidateSystemSecretCache()
  secrets.setWindowsSystemSecret('dataEncryptionKey', dataKey)
  secrets.setXiaomiPassportRefreshCredentials(refreshCredentials)
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
    assert(initial.mode === 'unconfigured' && initial.credentialSource === 'none' && initial.credentialWritable, 'Malformed environment Cookie did not expose manual setup')
    assert(initial.passportRefresh.configured && initial.passportRefresh.source === 'windows-dpapi' && initial.passportRefresh.available, 'Passport refresh should support initial Cookie creation')

    const originalFetch = global.fetch
    const initialRefreshResponses = [
      fakeResponse(200, JSON.stringify({ result: 'ok', code: 0, data: { loginUrl: 'https://account.xiaomi.com/pass/serviceLogin?sid=i.mi.com&callback=https%3A%2F%2Fi.mi.com%2Fsts%3Fsid%3Di.mi.com' } })),
      fakeResponse(200, '&&&START&&&' + JSON.stringify({ ssecurity: 'initial-security', nonce: 21, location: 'https://i.mi.com/sts?sid=i.mi.com' })),
      fakeResponse(302, '', [
        'serviceToken=initial-dpapi-token; Domain=.i.mi.com; Path=/; Secure',
        'userId=10001; Domain=.mi.com; Path=/',
        'i.mi.com_slh=initial-dpapi-slh; Domain=.i.mi.com; Path=/',
        'i.mi.com_ph=initial-dpapi-ph; Domain=.i.mi.com; Path=/'
      ])
    ]
    let initialRefreshFetches = 0
    global.fetch = async () => initialRefreshResponses[initialRefreshFetches++]
    const initialized = await service.refreshNow()
    global.fetch = originalFetch
    assert(initialized.configured && initialized.mode === 'ready' && initialRefreshFetches === 3, 'Passport credentials did not create the initial Cookie')
    assert(secrets.getXiaomiCloudCookie().includes('serviceToken=initial-dpapi-token'), 'Initial Cookie was not persisted to DPAPI')

    await expectStatus(() => service.saveCredentials({ cookie: 'userId=missing-token' }), 400)
    const saved = service.saveCredentials({ cookie: firstCookie })
    assert(saved.configured && saved.mode === 'ready', 'Saved credential did not configure the running connector')
    assert(saved.credentialSource === 'windows-dpapi' && saved.credentialWritable, 'DPAPI credential source metadata is incorrect')
    assert(saved.passportRefresh.available === true, 'Passport refresh did not become available after Cookie setup')

    const raw = readFileSync(secretPath, 'utf8')
    assert(!raw.includes(firstCookie) && !raw.includes('ui-dpapi-token-value-32') && !raw.includes(refreshCredentials.passToken), 'DPAPI file contains plaintext credential material')
    assert(secrets.getXiaomiCloudCookie() === firstCookie, 'Saved DPAPI Cookie was not available after cache invalidation')
    assert(secrets.getDataEncryptionSecret() === dataKey, 'Saving the Cookie replaced an unrelated DPAPI secret')
    assert(!JSON.stringify(saved).includes(firstCookie) && !JSON.stringify(saved).includes('ui-dpapi-token-value-32'), 'Credential leaked through connector status')


    let refreshFetches = 0
    const refreshResponses = [
      fakeResponse(200, JSON.stringify({ result: 'ok', code: 0, data: { loginUrl: 'https://account.xiaomi.com/pass/serviceLogin?sid=i.mi.com&callback=https%3A%2F%2Fi.mi.com%2Fsts%3Fsid%3Di.mi.com' } })),
      fakeResponse(200, '&&&START&&&' + JSON.stringify({ ssecurity: 'test-security', nonce: 42, location: 'https://i.mi.com/sts?sid=i.mi.com' })),
      fakeResponse(302, '', [
        'serviceToken=single-flight-token; Domain=.i.mi.com; Path=/; Secure',
        'userId=10001; Domain=.mi.com; Path=/',
        'i.mi.com_slh=single-flight-slh; Domain=.i.mi.com; Path=/',
        'i.mi.com_ph=single-flight-ph; Domain=.i.mi.com; Path=/'
      ])
    ]
    global.fetch = async () => {
      const response = refreshResponses[refreshFetches]
      refreshFetches += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return response
    }
    const { XiaomiPassportService } = require('../dist/xiaomi-notes/xiaomi-passport.service')
    const passportService = new XiaomiPassportService()
    const [firstRefresh, secondRefresh] = await Promise.all([passportService.refreshCookie(firstCookie), passportService.refreshCookie(firstCookie)])
    global.fetch = originalFetch
    assert(firstRefresh === secondRefresh && refreshFetches === 3, 'Concurrent Passport refresh was not single-flight')

    const controller = new XiaomiNotesController({ saveCredentials: () => ({ redacted: true }) }, {})
    const localResult = controller.saveCredentials({ cookie: firstCookie }, { socket: { remoteAddress: '127.0.0.1' } })
    assert(localResult.redacted === true, 'Loopback credential request was not accepted')
    await expectStatus(() => controller.saveCredentials({ cookie: firstCookie }, { socket: { remoteAddress: '192.0.2.10' } }), 403)

    process.env.XIAOMI_CLOUD_COOKIE = environmentCookie
    const environmentService = new XiaomiNotesService(history)
    const environmentStatus = environmentService.getStatus()
    assert(environmentStatus.credentialSource === 'environment' && !environmentStatus.credentialWritable, 'Environment credential priority status is incorrect')
    assert(!environmentStatus.passportRefresh.available, 'Passport refresh must not overwrite an environment Cookie')
    await expectStatus(() => environmentService.saveCredentials({ cookie: firstCookie }), 409)
    await expectStatus(() => environmentService.refreshNow(), 409)
    assert(secrets.getXiaomiCloudCookie() === environmentCookie, 'Environment Cookie did not retain priority')

    console.log(JSON.stringify({
      manualEntryAvailable: true,
      malformedCookieRejected: true,
      malformedEnvironmentIgnored: true,
      dpapiEncrypted: true,
      hotReloaded: true,
      statusRedacted: true,
      environmentPriority: true,
      environmentOverrideRejected: true,
      unrelatedSecretsPreserved: true,
      remoteSubmissionRejected: true,
      passportRefreshStored: true,
      initialCookieCreated: true,
      refreshSingleFlight: true
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

function fakeResponse(status, body, setCookies = []) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(body)) : null,
      getSetCookie: () => setCookies
    },
    text: async () => body
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
