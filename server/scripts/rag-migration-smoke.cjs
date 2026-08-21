const { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { randomBytes } = require('node:crypto')

const root = resolve(mkdtempSync(join(tmpdir(), 'terra-rag-migration-')))
const ragPath = join(root, 'rag.json')
process.env.TERRA_DATA_ENCRYPTION_KEY = randomBytes(32).toString('hex')
process.env.TERRA_WINDOWS_SECRETS_FILE = join(root, 'secrets.json')
process.env.TERRA_RAG_FILE = ragPath
process.env.TERRA_RAG_VECTOR_PATH = join(root, 'rag-vectors')
process.env.TERRA_RESOURCE_FILE = join(root, 'resources.json')
process.env.TERRA_RESOURCE_SYNC_FILE = join(root, 'resource-sync.json')
process.env.TERRA_RSS_FILE = join(root, 'rss.json')
process.env.TERRA_BLOG_FILE = join(root, 'blog.json')
process.env.TERRA_TRAVEL_FILE = join(root, 'travel.json')
process.env.TERRA_TRAVEL_ATTACHMENTS_DB = join(root, 'travel.sqlite')
process.env.TERRA_XIAOMI_HISTORY_FILE = join(root, 'history.json')
process.env.TERRA_XIAOMI_METADATA_FILE = join(root, 'metadata.json')
process.env.XIAOMI_CLOUD_COOKIE = ''

const documentId = '11111111-1111-4111-8111-111111111111'
const legacy = {
  version: 1,
  revision: 4,
  documents: [{ id: documentId, title: 'Legacy note', content: 'Legacy migration text about trains.', contentHash: 'a'.repeat(64), summary: 'Legacy migration text about trains.', tags: ['legacy'], privacy: 'private', mimeType: 'text/plain', source: 'manual', sensitiveFindings: [], injectionFindings: [], chunkCount: 1, createdAt: 1, updatedAt: 2, indexedAt: 2 }],
  chunks: [{ id: 'b'.repeat(32), documentId, index: 0, heading: '', text: 'Legacy migration text about trains.', startOffset: 0, endOffset: 36, contentHash: 'c'.repeat(64), terms: { legacy: 1 }, tokenCount: 1, vector: [[0, 1]], injectionRisk: 'none', injectionSignals: [] }]
}
writeFileSync(ragPath, `${JSON.stringify(legacy)}\n`)
let app

function assert(condition, message) { if (!condition) throw new Error(message) }
async function main() {
  require('reflect-metadata')
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const express = require('express')
  app = await NestFactory.create(AppModule, { bodyParser: false, logger: false, abortOnError: false })
  app.use(express.json({ limit: '512kb' })); app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1')
  const port = app.getHttpServer().address().port
  const response = await fetch(`http://127.0.0.1:${port}/api/rag/documents`)
  assert(response.ok, `Migration documents request failed: ${response.status}`)
  const documents = await response.json()
  assert(documents.length === 1 && documents[0].title === 'Legacy note' && documents[0].vectorState === 'disabled', 'Legacy RAG state was not migrated without data loss')
  const migrated = JSON.parse(readFileSync(ragPath, 'utf8'))
  assert(migrated.version === 1 || migrated.format === 'terra-rag-state', 'Unexpected migrated store shape')
  assert(existsSync(`${ragPath}.pre-rag-v2.bak`), 'Migration recovery copy was not created')
  const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/rag/settings`)
  const settings = await settingsResponse.json()
  assert(settings.settings.xiaomiDefaultPrivacy === 'private', 'Default Xiaomi privacy setting was not supplied for migrated state')
  const updatedResponse = await fetch(`http://127.0.0.1:${port}/api/rag/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoSyncXiaomi: false, xiaomiDefaultPrivacy: 'secret' }) })
  const updated = await updatedResponse.json()
  assert(updatedResponse.ok && updated.storedSettings.autoSyncXiaomi === false && updated.storedSettings.xiaomiDefaultPrivacy === 'secret', 'Loopback RAG settings update failed')
  const queryResponse = await fetch(`http://127.0.0.1:${port}/api/rag/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'legacy migration trains', maxPrivacy: 'private' }) })
  const query = await queryResponse.json()
  assert(queryResponse.ok && query.retrieval?.mode === 'local' && query.citations.length === 1, 'Legacy data was not locally queryable after migration')
  console.log(JSON.stringify({ success: true, migratedDocuments: documents.length, recoveryCopy: true, bm25Preserved: true, settingsV2: true, localFallback: true }, null, 2))
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 }).finally(async () => { try { if (app) await app.close() } catch (error) { console.error(error.stack || error); process.exitCode = 1 } try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch { /* temp cleanup is best effort on Windows */ } })
