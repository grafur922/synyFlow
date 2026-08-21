const { createServer } = require('node:http')
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { randomBytes } = require('node:crypto')

const root = resolve(mkdtempSync(join(tmpdir(), 'terra-rag-hybrid-')))
const vectorRoot = join(root, 'rag-vectors')
mkdirSync(vectorRoot, { recursive: true })
Object.assign(process.env, {
  TERRA_DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  TERRA_WINDOWS_SECRETS_FILE: join(root, 'secrets.json'),
  TERRA_RAG_FILE: join(root, 'rag.json'),
  TERRA_RAG_VECTOR_PATH: vectorRoot,
  TERRA_RESOURCE_FILE: join(root, 'resources.json'),
  TERRA_RESOURCE_SYNC_FILE: join(root, 'resource-sync.json'),
  TERRA_RSS_FILE: join(root, 'rss.json'),
  TERRA_BLOG_FILE: join(root, 'blog.json'),
  TERRA_BLOG_CONTENT_DIR: join(root, 'blog-content'),
  TERRA_TRAVEL_FILE: join(root, 'travel.json'),
  TERRA_TRAVEL_ATTACHMENTS_DB: join(root, 'travel.sqlite'),
  TERRA_XIAOMI_HISTORY_FILE: join(root, 'history.json'),
  TERRA_XIAOMI_METADATA_FILE: join(root, 'metadata.json'),
  XIAOMI_CLOUD_COOKIE: '',
  TERRA_RAG_ALIYUN_API_KEY: 'sk-hybrid-test-key-1234567890'
})
mkdirSync(join(root, 'blog-content'))

let requests = []
const providerServer = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  requests.push(body)
  const input = Array.isArray(body.input) ? body.input : []
  const dimensions = Number(body.dimensions)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: Array.from({ length: dimensions }, (_, offset) => offset === 0 ? 1 : 0) })), usage: { total_tokens: 5 } }))
})

function assert(condition, message) { if (!condition) throw new Error(message) }
async function main() {
  await new Promise((resolveListen) => providerServer.listen(0, '127.0.0.1', resolveListen))
  const baseUrl = `http://127.0.0.1:${providerServer.address().port}`
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { RagService } = require('../dist/rag/rag.service')
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const rag = app.get(RagService)
  await rag.updateSettings({ enabled: true, baseUrl, model: 'text-embedding-v4', dimensions: 768, batchSize: 10 })
  await rag.create({ title: 'Hybrid travel note', content: '杭州列车的语义检索测试内容。', tags: ['hybrid'], privacy: 'private', mimeType: 'text/plain', source: 'manual' })
  await rag.create({ title: 'Secret marker', content: 'SECRET-HYBRID-MARKER should never be sent to Aliyun.', tags: ['secret'], privacy: 'secret', mimeType: 'text/plain', source: 'manual' })
  const rebuild = await rag.rebuildVectorIndex()
  assert(rebuild.ok && rebuild.vectorized > 0, 'Dense rebuild did not vectorize an eligible document')
  const status = await rag.getStatus()
  assert(status.vectorStore.available && status.vectorCoverage.ready === 1 && status.vectorCoverage.localOnly === 1, 'Hybrid vector coverage/status is incorrect')
  const beforeQuery = requests.length
  const hybrid = await rag.query({ query: '杭州列车语义检索', maxPrivacy: 'private', limit: 5 })
  assert(hybrid.retrieval.mode === 'hybrid' && hybrid.provider.externalRequests === true && requests.length > beforeQuery, 'Normal query did not use dense hybrid retrieval')
  assert(hybrid.citations.some((citation) => citation.documentTitle === 'Hybrid travel note'), 'Hybrid query missed the eligible document')
  const beforeSensitive = requests.length
  const sensitive = await rag.query({ query: 'password=HIGH-RISK-HYBRID-123456', maxPrivacy: 'private', limit: 5 })
  assert(sensitive.retrieval.mode === 'local' && sensitive.provider.externalRequests === false && requests.length === beforeSensitive, 'High-risk query was sent to Aliyun')
  assert(!JSON.stringify(requests).includes('SECRET-HYBRID-MARKER'), 'Secret document content was sent to Aliyun')
  await app.close()
  console.log(JSON.stringify({ success: true, nativeLanceDb: true, denseRebuild: true, hybridQuery: true, secretExcluded: true, highRiskLocalFallback: true }, null, 2))
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 }).finally(async () => { await new Promise((resolveClose) => providerServer.close(resolveClose)); try { rmSync(root, { recursive: true, force: true }) } catch {} })

