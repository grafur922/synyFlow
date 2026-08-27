import { Injectable, Logger } from '@nestjs/common'
import { getAliyunEmbeddingApiKey, getAliyunEmbeddingCredentialStatus } from '../security/secrets'

export interface RerankCandidate {
  id: string
  text: string
  score: number
  keywordScore?: number
  vectorScore?: number
}

export interface RerankResultItem {
  id: string
  index: number
  relevanceScore: number
}

export interface RerankResponse {
  results: RerankResultItem[]
  provider: 'aliyun-gte-rerank' | 'local-heuristic'
}

const DASHSCOPE_RERANK_URL = 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank'
const REQUEST_TIMEOUT_MS = 10_000

@Injectable()
export class RerankProvider {
  private readonly logger = new Logger(RerankProvider.name)

  getStatus() {
    const cred = getAliyunEmbeddingCredentialStatus()
    return {
      configured: cred.configured,
      model: 'gte-rerank',
      remoteAvailable: cred.configured
    }
  }

  /**
   * 对候选笔记/片段进行高精度重排
   */
  async rerank(query: string, candidates: RerankCandidate[], topN = 10): Promise<RerankResponse> {
    if (!candidates.length) {
      return { results: [], provider: 'local-heuristic' }
    }

    const apiKey = getAliyunEmbeddingApiKey()
    if (apiKey) {
      try {
        const remoteResults = await this.callDashScopeRerank(apiKey, query, candidates, topN)
        if (remoteResults.length > 0) {
          return {
            results: remoteResults,
            provider: 'aliyun-gte-rerank'
          }
        }
      } catch (err: any) {
        this.logger.warn(`Remote rerank failed, falling back to local heuristic: ${err?.message || err}`)
      }
    }

    // 本地启发式智能重排（兜底机制）
    const localResults = this.localHeuristicRerank(query, candidates, topN)
    return {
      results: localResults,
      provider: 'local-heuristic'
    }
  }

  /**
   * 调用阿里云通义百炼 gte-rerank API
   */
  private async callDashScopeRerank(
    apiKey: string,
    query: string,
    candidates: RerankCandidate[],
    topN: number
  ): Promise<RerankResultItem[]> {
    const documents = candidates.map((c) => c.text.slice(0, 2000))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const res = await fetch(DASHSCOPE_RERANK_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gte-rerank',
          input: {
            query,
            documents
          },
          parameters: {
            return_documents: false,
            top_n: Math.min(topN, candidates.length)
          }
        }),
        signal: controller.signal
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`DashScope HTTP ${res.status}: ${errText}`)
      }

      const json = (await res.json()) as {
        output?: {
          results?: Array<{ index: number; relevance_score: number }>
        }
      }

      const items = json.output?.results
      if (!Array.isArray(items)) {
        throw new Error('Invalid DashScope rerank response format')
      }

      return items.map((item) => ({
        id: candidates[item.index]?.id ?? `candidate-${item.index}`,
        index: item.index,
        relevanceScore: item.relevance_score
      }))
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 本地智能启发式重排（针对短文本、手机号、邮箱、连续子串、BM25与向量做综合加权）
   */
  private localHeuristicRerank(
    query: string,
    candidates: RerankCandidate[],
    topN: number
  ): RerankResultItem[] {
    const queryLower = query.toLowerCase()
    const queryTokens = this.tokenize(queryLower)

    // 提取 query 中的特征模式（如邮箱、数字/手机号意图等）
    const asksForPhone = /手机|电话|号码|tel|phone|mobile|1\d{10}/i.test(queryLower)
    const asksForEmail = /邮箱|邮件|email|mail|@/i.test(queryLower)

    const scored = candidates.map((c, index) => {
      const textLower = c.text.toLowerCase()
      let heuristicBoost = 0

      // 1. 特征模式匹配：如果提问手机号且文本中包含中国手机号 (1[3-9]\d{9})
      if (asksForPhone && /1[3-9]\d{9}/.test(c.text)) {
        heuristicBoost += 0.35
      }

      // 2. 特征模式匹配：如果提问邮箱且文本中包含标准邮箱
      if (asksForEmail && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(c.text)) {
        heuristicBoost += 0.25
      }

      // 3. Query 中特定词的精确包含加权
      let matchedTokens = 0
      for (const token of queryTokens) {
        if (textLower.includes(token)) {
          matchedTokens++
          // 越是长词/特定词，加权越高
          heuristicBoost += token.length >= 4 ? 0.15 : 0.05
        }
      }

      // 4. 连续子串覆盖奖励
      if (textLower.includes(queryLower) || (queryLower.length > 5 && textLower.includes(queryLower.slice(0, 5)))) {
        heuristicBoost += 0.3
      }

      // 5. 综合分数：结合原有的召回基础分 (vectorScore, keywordScore) + 启发式加权
      const baseScore = c.score || 0
      const finalScore = Math.min(1.0, 0.4 * baseScore + 0.6 * (heuristicBoost + (matchedTokens / Math.max(1, queryTokens.length)) * 0.4))

      return {
        id: c.id,
        index,
        relevanceScore: Number(finalScore.toFixed(4))
      }
    })

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore)
    return scored.slice(0, topN)
  }

  private tokenize(text: string): string[] {
    return text
      .split(/[\s,，.。!！?？:：;；、/\\_@\-]+/g)
      .filter((t) => t.trim().length > 0)
  }
}
