const assert = require('node:assert')
const { RerankProvider } = require('../dist/rag/rerank.provider')

async function run() {
  console.log('[Smoke] Starting Rerank & Intent Pattern Retrieval Smoke Test...')

  // 1. 测试 RerankProvider 本地启发式打分
  const rerankProvider = new RerankProvider()
  const query = '我有哪些出现了手机号的笔记'

  const candidates = [
    {
      id: 'doc-report-with-word',
      text: '关于2026年全球智能手机出货量与移动互联网生态发展的研究报告分析...',
      score: 0.70 // 包含“手机”字样，初始分高
    },
    {
      id: 'doc-pure-phone',
      text: '客户对接人 张经理 17833452221',
      score: 0.45 // 纯手机号，原本无“手机”二字，现在获得模式召回分
    },
    {
      id: 'doc-park',
      text: '今天天气晴朗，去公园跑步。',
      score: 0.10
    }
  ]

  const rerankResult = await rerankProvider.rerank(query, candidates, 3)
  console.log('[Smoke] Rerank Provider used:', rerankResult.provider)
  console.log('[Smoke] Reranked Results:', rerankResult.results)

  assert(rerankResult.results.length === 3, 'Should return 3 ranked candidates')
  assert.strictEqual(
    rerankResult.results[0].id,
    'doc-pure-phone',
    'The pure phone number note (17833452221) MUST be ranked #1 after pattern-aware reranking!'
  )
  console.log('✅ [Smoke] Pure phone note (17833452221) without the word "手机" is successfully ranked Top 1!')

  console.log('[Smoke] All tests passed!')
}

run().catch((err) => {
  console.error('❌ [Smoke] Test failed:', err)
  process.exit(1)
})
