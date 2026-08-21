const { XiaomiNotesRagSyncService } = require('../dist/rag/xiaomi-notes-rag-sync.service')

function assert(condition, message) { if (!condition) throw new Error(message) }
async function waitFor(service, predicate, timeout = 3000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const status = await service.getStatus()
    if (predicate(status)) return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for Xiaomi RAG sync state')
}

async function main() {
  const detailCalls = []
  let pageMode = 'initial'
  const xiaomi = {
    async findPage({ cursor }) {
      if (pageMode === 'failure') {
        if (!cursor) return { notes: [{ id: 'new', modifyDate: 2, tag: 'n' }], nextCursor: 'next', lastPage: false }
        throw new Error('simulated pagination failure')
      }
      if (pageMode === 'cancel') {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return { notes: [], lastPage: true }
      }
      if (pageMode === 'after-delete') return { notes: [{ id: 'a', modifyDate: 1, tag: 'same' }], lastPage: true }
      return { notes: [{ id: 'a', modifyDate: 1, tag: 'same' }, { id: 'b', modifyDate: 2, tag: 'new' }], lastPage: true }
    },
    async findOne(id) { detailCalls.push(id); return { id, title: id, content: `content-${id}`, preview: '', modifyDate: id === 'a' ? 1 : 2, tag: id === 'a' ? 'same' : 'new', createDate: 1 } }
  }
  let ledger = [{ source: 'xiaomi-note', sourceItemId: 'a', ragDocumentId: 'doc-a', remoteModifyDate: 1, remoteTag: 'same', contentHash: 'a'.repeat(64), lastSeenGeneration: 'old', lastSeenAt: 1, state: 'active', retryCount: 0 }, { source: 'xiaomi-note', sourceItemId: 'old', ragDocumentId: 'doc-old', remoteModifyDate: 1, remoteTag: '', contentHash: 'b'.repeat(64), lastSeenGeneration: 'old', lastSeenAt: 1, state: 'active', retryCount: 0 }]
  const upserts = []
  let finalizeCalls = 0
  const rag = {
    async getXiaomiSyncLedger() { return ledger },
    async markXiaomiNoteSeen(note, generation) { const item = ledger.find((entry) => entry.sourceItemId === note.id); if (item) item.lastSeenGeneration = generation },
    async upsertXiaomiNote(note, generation) { upserts.push(note.id); return { outcome: 'created', vectorized: false, localOnly: false } },
    async markXiaomiNoteSyncFailed() {},
    async finalizeXiaomiGeneration() { finalizeCalls += 1; return { deleted: 1 } },
    async removeXiaomiSourceItem() { return { deleted: true } },
    async getSettings() { return { settings: { autoRetry: false } } }
  }
  const service = new XiaomiNotesRagSyncService(xiaomi, rag)
  await service.requestFullSync()
  const first = await waitFor(service, (status) => status.state === 'idle' && status.finishedAt)
  assert(detailCalls.length === 1 && detailCalls[0] === 'b', 'Unchanged Xiaomi notes were not skipped without a detail request')
  assert(upserts.length === 1 && upserts[0] === 'b', 'Changed/new Xiaomi note was not upserted')
  assert(first.skipped === 1 && first.created === 1, 'Incremental counters are incorrect')
  assert(finalizeCalls === 1, 'Successful full scan did not finalize deletion generation')

  pageMode = 'after-delete'
  await service.requestFullSync()
  const second = await waitFor(service, (status) => status.state === 'idle' && status.finishedAt > first.finishedAt)
  assert(second.deleted === 1, 'Missing-note deletion was not propagated after complete scan')

  pageMode = 'failure'
  await service.requestFullSync()
  const failed = await waitFor(service, (status) => status.state === 'failed')
  assert(failed.error && finalizeCalls === 2, 'Pagination failure did not block deletion finalization')

  pageMode = 'cancel'
  await service.requestFullSync()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await service.cancel()
  const cancelled = await waitFor(service, (status) => status.state === 'idle' && status.error)
  assert(cancelled.error.includes('cancelled'), 'Cancellation did not report a safe partial-sync result')

  console.log(JSON.stringify({ success: true, unchangedSkipped: true, changedUpserted: true, deletionAfterCompleteScan: true, paginationFailureSafe: true, cancellationSafe: true }, null, 2))
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 })
