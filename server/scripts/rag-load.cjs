const { mkdtempSync, mkdirSync, rmSync } = require('node:fs')
const { randomBytes } = require('node:crypto')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')

require('reflect-metadata')

const tempRoot = resolve(mkdtempSync(join(tmpdir(), 'terra-rag-load-')))
mkdirSync(join(tempRoot, 'blog-content'))
Object.assign(process.env, {
  TERRA_DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  TERRA_DATA_FILE: join(tempRoot, 'tasks.json'),
  TERRA_RESOURCE_FILE: join(tempRoot, 'resources.json'),
  TERRA_RSS_FILE: join(tempRoot, 'rss.json'),
  TERRA_RSS_SCHEDULER_ENABLED: 'false',
  TERRA_BLOG_FILE: join(tempRoot, 'blog.json'),
  TERRA_BLOG_CONTENT_DIR: join(tempRoot, 'blog-content'),
  TERRA_TRAVEL_FILE: join(tempRoot, 'travel.json'),
  TERRA_TRAVEL_ATTACHMENTS_DB: join(tempRoot, 'travel-attachments.sqlite'),
  TERRA_RAG_FILE: join(tempRoot, 'rag.json'),
    TERRA_RAG_VECTOR_PATH: join(tempRoot, 'rag-vectors'),
    TERRA_WINDOWS_SECRETS_FILE: join(tempRoot, 'secrets.json'),
  TERRA_XIAOMI_HISTORY_FILE: join(tempRoot, 'history.json'),
  TERRA_XIAOMI_METADATA_FILE: join(tempRoot, 'metadata.json'),
  XIAOMI_CLOUD_COOKIE: ''
})

let app

async function main() {
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { RagService } = require('../dist/rag/rag.service')
  app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const rag = app.get(RagService)

  const documentCount = 30
  const ingestionStarted = performance.now()
  for (let index = 0; index < documentCount; index += 1) {
    const paragraphs = Array.from({ length: 8 }, (_, paragraph) => `Section ${paragraph}. Load document ${index} discusses marker-${index}, retrieval latency, encrypted local storage, transport planning and knowledge citations. The repeatable measurement sentence number is ${index * 100 + paragraph}.`).join('\n\n')
    await rag.create({ title: `Load document ${index}`, content: paragraphs, tags: ['load', `group-${index % 5}`], privacy: index === 29 ? 'secret' : 'private', mimeType: 'text/plain', source: 'manual' })
  }
  const ingestionMs = Math.round(performance.now() - ingestionStarted)

  const firstStarted = performance.now()
  const first = await rag.query({ query: 'marker-17 retrieval latency citations', maxPrivacy: 'private', limit: 8 })
  const firstQueryMs = round(performance.now() - firstStarted)
  if (!first.citations.some((citation) => citation.documentTitle === 'Load document 17')) throw new Error('Load query did not retrieve its target')

  const concurrentStarted = performance.now()
  const concurrent = await Promise.all(Array.from({ length: 25 }, () => rag.query({ query: 'marker-17 retrieval latency citations', maxPrivacy: 'private', limit: 8 })))
  const concurrentCachedMs = round(performance.now() - concurrentStarted)
  if (concurrent.some((result) => !result.citations.length)) throw new Error('Concurrent cached query returned no citations')

  const secretDefault = await rag.query({ query: 'marker-29 measurement sentence', maxPrivacy: 'private' })
  if (secretDefault.citations.some((citation) => citation.documentTitle === 'Load document 29')) throw new Error('Load test leaked secret content')
  const status = await rag.getStatus()

  if (ingestionMs > 90_000) throw new Error(`Encrypted ingestion exceeded 90 seconds: ${ingestionMs}ms`)
  if (firstQueryMs > 2_000) throw new Error(`First query exceeded 2 seconds: ${firstQueryMs}ms`)
  if (concurrentCachedMs > 2_000) throw new Error(`Cached concurrent queries exceeded 2 seconds: ${concurrentCachedMs}ms`)

  console.log(JSON.stringify({ documents: status.documentCount, chunks: status.chunkCount, encryptedIngestionMs: ingestionMs, firstQueryMs, concurrentCachedQueries: concurrent.length, concurrentCachedMs, defaultSecretExcluded: true }, null, 2))
}

function round(value) { return Math.round(value * 100) / 100 }

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => {
    if (app) await app.close()
    const tempBase = resolve(tmpdir())
    if ((tempRoot.startsWith(`${tempBase}\\`) || tempRoot.startsWith(`${tempBase}/`)) && basename(tempRoot).startsWith('terra-rag-load-')) rmSync(tempRoot, { recursive: true, force: true })
  })
