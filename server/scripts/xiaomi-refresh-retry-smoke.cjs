require('reflect-metadata')

process.env.XIAOMI_CLOUD_COOKIE = 'serviceToken=old-token; userId=10001; i.mi.com_slh=old; i.mi.com_ph=old'
process.env.TERRA_XIAOMI_FAILURE_THRESHOLD = '3'
process.env.TERRA_XIAOMI_CIRCUIT_COOLDOWN_MS = '5000'

const { XiaomiNotesService } = require('../dist/xiaomi-notes/xiaomi-notes.service')

const history = {
  getStorageStatus: () => ({ available: true, encryptedAtRest: true, encryptionConfigured: true, migrationPending: false, format: 'sqlite', message: 'test' })
}

async function main() {
  const originalFetch = global.fetch
  const requests = []
  let refreshCalls = 0
  const passport = {
    canRefresh: () => true,
    refreshCookie: async (cookie) => {
      refreshCalls += 1
      return cookie.replace('old-token', 'new-token')
    },
    getStatus: () => ({ configured: true, source: 'environment', writable: false, available: true, refreshing: false, message: 'test' })
  }
  try {
    let call = 0
    global.fetch = async (_url, init) => {
      requests.push(new Headers(init.headers).get('Cookie'))
      call += 1
      if (call === 1) return jsonResponse({ result: 'error', code: 401, description: 'expired' }, 401)
      return jsonResponse({ result: 'ok', code: 0, data: { entries: [], folders: [], lastPage: true, syncTag: '50993292568436800' } })
    }
    const service = new XiaomiNotesService(history, passport)
    const page = await service.findPage({ forceRefresh: true })
    assert(page.lastPage && refreshCalls === 1 && requests.length === 2, '401 refresh retry did not complete')
    assert(requests[0].includes('old-token') && requests[1].includes('new-token'), 'retry did not use refreshed Cookie')
    assert(service.getStatus().mode === 'ready' && service.getStatus().consecutiveFailures === 0, 'successful retry left connector unhealthy')

    call = 0
    refreshCalls = 0
    global.fetch = async () => {
      call += 1
      return jsonResponse({ result: 'error', code: 401, description: 'expired' }, 401)
    }
    const failed = new XiaomiNotesService(history, passport)
    await expectStatus(() => failed.findPage({ forceRefresh: true }), 503)
    assert(refreshCalls === 1 && call === 2 && failed.getStatus().mode === 'credentials_invalid', 'second 401 was not bounded')

    console.log(JSON.stringify({ singleFlightRetry: true, refreshedCookieUsed: true, retrySuccessHealthy: true, secondAuthFailureBounded: true }, null, 2))
  } finally {
    global.fetch = originalFetch
    delete process.env.XIAOMI_CLOUD_COOKIE
  }
}
function jsonResponse(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }) }
async function expectStatus(work, status) { try { await work() } catch (error) { if (typeof error?.getStatus === 'function' && error.getStatus() === status) return; throw error } throw new Error(`Expected status ${status}`) }
function assert(condition, message) { if (!condition) throw new Error(message) }
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
