const { mkdtempSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const root = mkdtempSync(join(tmpdir(), 'terra-rag-vector-'))
process.env.TERRA_RAG_VECTOR_PATH = root
const { LanceDbVectorStore } = require('../dist/rag/lancedb-vector.store')

function assert(condition, message) { if (!condition) throw new Error(message) }
async function main() {
  const store = new LanceDbVectorStore()
  const status = await store.getStatus()
  if (!status.packageInstalled) {
    let invalidRejected = false
    try { await store.upsert('test-version', [{ chunkId: 'not-a-chunk', documentId: 'doc', contentHash: 'a'.repeat(64), privacy: 'private', injectionRisk: 'none', vectorVersion: 'test-version', vector: [1, 2] }]) }
    catch { invalidRejected = true }
    assert(invalidRejected, 'Vector store did not reject invalid records while degraded')
    console.log(JSON.stringify({ success: true, packageInstalled: false, degradedToLocalRetrieval: true, validationGuard: true, note: 'Install @lancedb/lancedb to run native table/upsert/search/delete verification.' }, null, 2))
    return
  }
  const version = 'aliyun:text-embedding-v4:3:nfkc-v1:rag-chunker-v1'
  const records = [{ chunkId: 'a'.repeat(32), documentId: 'doc-1', contentHash: 'b'.repeat(64), privacy: 'private', injectionRisk: 'none', vectorVersion: version, vector: [1, 0, 0] }]
  await store.upsert(version, records)
  const matches = await store.search(version, [1, 0, 0], { limit: 5, maxPrivacy: 'private', includeFlagged: false })
  assert(matches.length === 1 && matches[0].documentId === 'doc-1', 'Native LanceDB search failed')
  await store.deleteByDocumentIds(version, ['doc-1'])
  assert((await store.search(version, [1, 0, 0], { limit: 5, maxPrivacy: 'private', includeFlagged: false })).length === 0, 'Native LanceDB document deletion failed')
  console.log(JSON.stringify({ success: true, packageInstalled: true, upsertSearchDelete: true }, null, 2))
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => rmSync(root, { recursive: true, force: true }))
