require('reflect-metadata')

process.env.XIAOMI_CLOUD_COOKIE = 'serviceToken=local-boundary-test-token; userId=local-test'
process.env.TERRA_XIAOMI_FAILURE_THRESHOLD = '3'
process.env.TERRA_XIAOMI_CIRCUIT_COOLDOWN_MS = '5000'
delete process.env.TERRA_XIAOMI_READ_ONLY

const { XiaomiNotesService } = require('../dist/xiaomi-notes/xiaomi-notes.service')

const history = {
  ensureAvailable: async () => undefined,
  getStorageStatus: () => ({
    available: true,
    encryptedAtRest: true,
    encryptionConfigured: true,
    migrationPending: false,
    format: 'encrypted',
    message: 'test'
  }),
  capture: async () => undefined,
  findArchive: async () => [],
  findByHistoryId: async () => { throw new Error('not used') },
  findAll: async () => [],
  findOne: async () => { throw new Error('not used') }
}

async function main() {
  const originalFetch = global.fetch
  try {
    let failedFetches = 0
    global.fetch = async () => {
      failedFetches += 1
      throw new Error('simulated upstream outage')
    }

    const failing = new XiaomiNotesService(history)
    for (let index = 0; index < 3; index += 1) {
      await expectFailure(() => failing.findPage({ forceRefresh: true }), 502)
    }
    const openStatus = failing.getStatus()
    assert(openStatus.mode === 'circuit_open' && !openStatus.writable, 'circuit did not open after consecutive failures')
    await expectFailure(() => failing.findPage({ forceRefresh: true }), 503)
    assert(failedFetches === 3, 'open circuit still called the upstream service')

    const audit = failing.getAuditEvents()
    const serializedAudit = JSON.stringify(audit)
    assert(audit.some((entry) => entry.outcome === 'blocked'), 'blocked request was not audited')
    assert(!serializedAudit.includes('serviceToken') && !serializedAudit.includes('/note/'), 'audit contains an upstream path or credential name')

    process.env.TERRA_XIAOMI_READ_ONLY = 'true'
    let readOnlyFetches = 0
    global.fetch = async () => {
      readOnlyFetches += 1
      throw new Error('read-only mode should not fetch for a mutation')
    }
    const readOnly = new XiaomiNotesService(history)
    assert(readOnly.getStatus().mode === 'readonly' && !readOnly.getStatus().writable, 'read-only status is incorrect')
    await expectFailure(() => readOnly.create({ title: 'blocked', content: 'blocked' }), 503)
    assert(readOnlyFetches === 0, 'read-only mutation reached the upstream service')

    delete process.env.TERRA_XIAOMI_READ_ONLY
    const { ServiceUnavailableException } = require('@nestjs/common')
    let unavailableHistoryFetches = 0
    global.fetch = async () => {
      unavailableHistoryFetches += 1
      throw new Error('unavailable history must block before fetch')
    }
    const unavailableHistory = new XiaomiNotesService({
      ...history,
      ensureAvailable: async () => { throw new ServiceUnavailableException('history unavailable') }
    })
    await expectFailure(() => unavailableHistory.create({ title: 'blocked', content: 'blocked' }), 503)
    assert(unavailableHistoryFetches === 0, 'unavailable history allowed an upstream mutation')

    let authFetches = 0
    global.fetch = async () => {
      authFetches += 1
      return new Response(JSON.stringify({ result: 'error', code: 401, description: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    const invalidCredentials = new XiaomiNotesService(history)
    await expectFailure(() => invalidCredentials.findPage({ forceRefresh: true }), 503)
    assert(invalidCredentials.getStatus().mode === 'credentials_invalid' && !invalidCredentials.getStatus().writable, 'invalid credentials status is incorrect')
    await expectFailure(() => invalidCredentials.findPage({ forceRefresh: true }), 503)
    assert(authFetches === 1, 'known-invalid credentials retried the upstream service')

    global.fetch = async () => jsonResponse({
      result: 'ok',
      code: 0,
      data: {
        entries: [{
          id: '50993292568436800',
          tag: '50993292568436800',
          type: 'note',
          status: 'normal',
          content: '<text indent="1">Boundary note</text>',
          createDate: 100,
          modifyDate: 200,
          folderId: 0,
          extraInfo: '{"title":"Boundary"}'
        }],
        folders: [],
        lastPage: true,
        syncTag: '50993292568436800'
      }
    })
    const healthy = new XiaomiNotesService(history)
    const page = await healthy.findPage({ forceRefresh: true })
    assert(page.lastPage && page.notes[0].title === 'Boundary' && page.syncCursor === '50993292568436800', 'valid Xiaomi page or persistent cursor was not normalized')
    assert(healthy.getStatus().mode === 'ready' && healthy.getStatus().consecutiveFailures === 0, 'successful request status is incorrect')

    global.fetch = async () => jsonResponse({ result: 'ok', code: 0, data: { entries: [], folders: [], lastPage: false } })
    const malformed = new XiaomiNotesService(history)
    await expectFailure(() => malformed.findPage({ forceRefresh: true }), 502)

    console.log(JSON.stringify({
      readOnlyBlocked: true,
      unavailableHistoryBlocked: true,
      circuitOpenedAfter: failedFetches,
      openCircuitSkippedFetch: true,
      invalidCredentialsStoppedFetch: true,
      auditRedacted: true,
      validPageNormalized: true,
      persistentCursorNormalized: true,
      missingCursorRejected: true
    }, null, 2))
  } finally {
    global.fetch = originalFetch
    delete process.env.TERRA_XIAOMI_READ_ONLY
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function expectFailure(work, status) {
  try {
    await work()
  } catch (error) {
    if (typeof error.getStatus === 'function' && error.getStatus() === status) return
    throw error
  }
  throw new Error(`Expected HTTP exception ${status}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
