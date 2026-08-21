const { createServer } = require('node:http')
const { mkdtempSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const root = mkdtempSync(join(tmpdir(), 'terra-rag-aliyun-'))
process.env.TERRA_WINDOWS_SECRETS_FILE = join(root, 'secrets.json')
process.env.TERRA_RAG_ALIYUN_API_KEY = 'sk-rag-test-key-1234567890'
const { AliyunEmbeddingProvider } = require('../dist/rag/aliyun-embedding.provider')

let requests = []
let mode = 'success'
let calls = 0
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  requests.push({ headers: request.headers, body })
  calls += 1
  if (mode === 'retry' && calls === 1) {
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' })
    response.end(JSON.stringify({ error: { code: 'rate_limited', message: process.env.TERRA_RAG_ALIYUN_API_KEY } }))
    return
  }
  if (mode === 'invalid') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }))
    return
  }
  if (mode === 'error') {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { code: 'bad_request', message: process.env.TERRA_RAG_ALIYUN_API_KEY } }))
    return
  }
  if (mode === 'timeout') return
  const input = Array.isArray(body.input) ? body.input : []
  const dimensions = Number(body.dimensions)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: Array.from({ length: dimensions }, (_, i) => i + 0.25) })), usage: { total_tokens: 7 } }))
})

function assert(condition, message) { if (!condition) throw new Error(message) }
function settings(overrides = {}) {
  return { enabled: true, provider: 'aliyun', baseUrl: `http://127.0.0.1:${server.address()?.port || 0}`, model: 'text-embedding-v4', dimensions: 3, batchSize: 10, concurrency: 1, timeoutMs: 1_000, retries: 1, autoSyncXiaomi: true, xiaomiDefaultPrivacy: 'private', autoRetry: true, ...overrides }
}
async function expectReject(action, pattern) {
  try { await action() } catch (error) { assert(pattern.test(String(error.message)), `Expected error ${pattern}, got ${error.message}`); return String(error.message) }
  throw new Error('Expected operation to reject')
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const provider = new AliyunEmbeddingProvider()
  const baseSettings = settings()

  const documents = await provider.embedDocuments([{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }], baseSettings)
  assert(documents.length === 2 && documents[0].vector.length === 3, 'Successful document embedding failed')
  assert(requests[0].body.model === 'text-embedding-v4' && requests[0].body.input.length === 2, 'Embedding request shape is incorrect')

  requests = []; calls = 0; mode = 'retry'
  const retryResult = await provider.embedQuery('retry me', baseSettings)
  assert(retryResult.length === 3 && requests.length === 2, '429 retry behavior failed')
  assert(!JSON.stringify(requests.map((item) => item.body)).includes(process.env.TERRA_RAG_ALIYUN_API_KEY), 'API key leaked into embedding request body')

  requests = []; mode = 'success'
  await provider.testConnection(baseSettings)
  assert(requests.at(-1).body.input[0] === 'Terra knowledge base embedding connection test.', 'Connection test sent non-fixed text')

  mode = 'invalid'
  await expectReject(() => provider.embedQuery('invalid', baseSettings), /invalid vector shape/)
  mode = 'error'
  const safeMessage = await expectReject(() => provider.embedQuery('error', { ...baseSettings, retries: 0 }), /request failed \(400/)
  assert(!safeMessage.includes(process.env.TERRA_RAG_ALIYUN_API_KEY), 'Provider error leaked API key')

  mode = 'success'
  await expectReject(() => provider.embedQuery('this input is longer than the tiny budget', { ...baseSettings, dailyTokenBudget: 1 }), /daily token budget/)

  mode = 'timeout'
  await expectReject(() => provider.embedQuery('timeout', { ...baseSettings, timeoutMs: 30, retries: 0 }), /timed out/)

  console.log(JSON.stringify({ success: true, retryRequests: 2, fixedConnectionTest: true, dimensionValidation: true, budgetGuard: true, timeoutGuard: true }, null, 2))
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => { server.close(); rmSync(root, { recursive: true, force: true }) })
