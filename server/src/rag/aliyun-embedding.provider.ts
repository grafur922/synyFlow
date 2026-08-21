import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { getAliyunEmbeddingApiKey, getAliyunEmbeddingCredentialStatus } from '../security/secrets'
import type { RagEmbeddingSettings } from './rag.model'

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_INPUT_CHARACTERS = 16_000

export interface EmbeddingDocument {
  id: string
  text: string
}

export interface EmbeddingResult {
  id: string
  vector: number[]
}

type OpenAiEmbeddingResponse = {
  data?: Array<{ index?: unknown; embedding?: unknown }>
  usage?: { prompt_tokens?: unknown; total_tokens?: unknown }
  error?: { code?: unknown; message?: unknown }
}

@Injectable()
export class AliyunEmbeddingProvider {
  readonly id = 'aliyun-openai-compatible'
  private usageDay = this.currentDay()
  private dailyTokensUsed = 0
  private dailyTokensReserved = 0
  private lastSuccessAt?: number
  private lastFailureAt?: number
  private lastError?: string

  getStatus(settings: RagEmbeddingSettings) {
    this.rollUsageDay()
    const credential = getAliyunEmbeddingCredentialStatus()
    return {
      id: this.id,
      enabled: settings.enabled,
      configured: settings.enabled && credential.configured,
      credential,
      model: settings.model,
      dimensions: settings.dimensions,
      baseUrl: settings.baseUrl,
      version: this.getVersion(settings),
      usage: {
        day: this.usageDay,
        usedTokens: this.dailyTokensUsed,
        budgetTokens: settings.dailyTokenBudget,
        remainingTokens: settings.dailyTokenBudget === undefined ? undefined : Math.max(0, settings.dailyTokenBudget - this.dailyTokensUsed - this.dailyTokensReserved)
      },
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError,
      message: !settings.enabled
        ? 'Dense semantic retrieval is disabled'
        : credential.configured
          ? 'Aliyun embedding is configured'
          : 'Aliyun embedding API Key is not configured'
    }
  }

  getVersion(settings: RagEmbeddingSettings) {
    return `aliyun:${settings.model}:${settings.dimensions}:nfkc-v1:rag-chunker-v1`
  }

  async embedDocuments(documents: EmbeddingDocument[], settings: RagEmbeddingSettings): Promise<EmbeddingResult[]> {
    if (!Array.isArray(documents) || !documents.length) return []
    if (documents.length > settings.batchSize || documents.length > 10) throw new Error('Embedding batch exceeds the configured limit')
    const seen = new Set<string>()
    for (const document of documents) {
      if (!document || typeof document.id !== 'string' || !document.id || seen.has(document.id)) throw new Error('Embedding document ID is invalid')
      seen.add(document.id)
      this.validateInput(document.text)
    }
    const vectors = await this.request(documents.map((item) => item.text), settings)
    return documents.map((document, index) => ({ id: document.id, vector: vectors[index] }))
  }

  async embedQuery(query: string, settings: RagEmbeddingSettings) {
    this.validateInput(query)
    const [vector] = await this.request([query], settings)
    return vector
  }

  async testConnection(settings: RagEmbeddingSettings) {
    const startedAt = Date.now()
    const [vector] = await this.request(['Terra knowledge base embedding connection test.'], settings)
    return {
      ok: true,
      provider: this.id,
      model: settings.model,
      dimensions: vector.length,
      latencyMs: Date.now() - startedAt
    }
  }

  private async request(input: string[], settings: RagEmbeddingSettings) {
    if (!settings.enabled) throw new ServiceUnavailableException('Aliyun embedding is disabled')
    const apiKey = getAliyunEmbeddingApiKey()
    if (!apiKey) throw new ServiceUnavailableException('Aliyun embedding API Key is not configured')
    const estimatedTokens = this.estimateTokens(input)
    const endpoint = `${settings.baseUrl.replace(/\/+$/, '')}/embeddings`
    let lastError: unknown
    try {
      this.reserveBudget(settings, estimatedTokens)
      for (let attempt = 0; attempt <= settings.retries; attempt += 1) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), settings.timeoutMs)
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: settings.model,
              input,
              dimensions: settings.dimensions,
              encoding_format: 'float'
            }),
            signal: controller.signal
          })
          const payload = await this.readResponse(response)
          if (!response.ok) {
            const error = new Error(this.safeProviderError(response.status, payload))
            if (!this.isRetryableStatus(response.status) || attempt >= settings.retries) throw error
            lastError = error
            await this.delay(this.retryDelay(attempt, response.headers.get('retry-after')))
            continue
          }
          const vectors = this.validateResponse(payload, input.length, settings.dimensions)
          this.commitBudget(estimatedTokens, this.responseTokens(payload, estimatedTokens))
          this.lastSuccessAt = Date.now()
          this.lastError = undefined
          return vectors
        } catch (error) {
          const safe = this.safeNetworkError(error)
          if (attempt >= settings.retries || !this.isRetryableError(error)) throw new ServiceUnavailableException(safe)
          lastError = error
          await this.delay(this.retryDelay(attempt))
        } finally {
          clearTimeout(timer)
        }
      }
      throw new ServiceUnavailableException(this.safeNetworkError(lastError))
    } catch (error) {
      this.releaseBudget(estimatedTokens)
      this.lastFailureAt = Date.now()
      this.lastError = this.safeNetworkError(error)
      throw error
    }
  }

  private reserveBudget(settings: RagEmbeddingSettings, tokens: number) {
    this.rollUsageDay()
    if (settings.dailyTokenBudget !== undefined && this.dailyTokensUsed + this.dailyTokensReserved + tokens > settings.dailyTokenBudget) {
      throw new ServiceUnavailableException('Aliyun embedding daily token budget is exhausted')
    }
    this.dailyTokensReserved += tokens
  }

  private releaseBudget(tokens: number) {
    this.dailyTokensReserved = Math.max(0, this.dailyTokensReserved - tokens)
  }

  private commitBudget(reserved: number, actual: number) {
    this.releaseBudget(reserved)
    this.dailyTokensUsed += actual
  }

  private responseTokens(payload: OpenAiEmbeddingResponse, fallback: number) {
    const total = Number(payload.usage?.total_tokens ?? payload.usage?.prompt_tokens)
    return Number.isSafeInteger(total) && total >= 0 ? total : fallback
  }

  private estimateTokens(input: string[]) {
    return Math.max(1, Math.ceil(input.reduce((sum, value) => sum + value.length, 0) / 4))
  }

  private rollUsageDay() {
    const day = this.currentDay()
    if (day === this.usageDay) return
    this.usageDay = day
    this.dailyTokensUsed = 0
    this.dailyTokensReserved = 0
  }

  private currentDay() {
    return new Date().toISOString().slice(0, 10)
  }

  private async readResponse(response: Response): Promise<OpenAiEmbeddingResponse> {
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Aliyun embedding response is too large')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('Aliyun embedding response is too large')
    if (!bytes.byteLength) return {}
    try { return JSON.parse(new TextDecoder().decode(bytes)) as OpenAiEmbeddingResponse }
    catch { throw new Error('Aliyun embedding returned invalid JSON') }
  }

  private validateResponse(payload: OpenAiEmbeddingResponse, expectedCount: number, dimensions: number) {
    if (!Array.isArray(payload.data) || payload.data.length !== expectedCount) throw new Error('Aliyun embedding returned an unexpected item count')
    const ordered = [...payload.data].sort((a, b) => Number(a.index) - Number(b.index))
    return ordered.map((item, position) => {
      if (item.index !== position || !Array.isArray(item.embedding) || item.embedding.length !== dimensions) {
        throw new Error('Aliyun embedding returned an invalid vector shape')
      }
      const vector = item.embedding.map(Number)
      if (!vector.every(Number.isFinite)) throw new Error('Aliyun embedding returned a non-finite vector')
      return vector
    })
  }

  private validateInput(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Embedding input is required')
    if (value.length > MAX_INPUT_CHARACTERS || value.includes('\0')) throw new Error('Embedding input exceeds its safety limit')
  }

  private safeProviderError(status: number, payload: OpenAiEmbeddingResponse) {
    const code = typeof payload.error?.code === 'string' ? payload.error.code.replace(/[^a-z0-9._-]/gi, '').slice(0, 80) : ''
    return `Aliyun embedding request failed (${status}${code ? `, ${code}` : ''})`
  }

  private safeNetworkError(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'Aliyun embedding request timed out'
    const message = error instanceof Error ? error.message : 'Aliyun embedding request failed'
    if (/timed out|too large|invalid|unexpected|failed \(\d+/i.test(message)) return message.slice(0, 240)
    return 'Aliyun embedding request failed'
  }

  private isRetryableStatus(status: number) {
    return status === 408 || status === 409 || status === 429 || status >= 500
  }

  private isRetryableError(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return true
    return error instanceof TypeError || /fetch|network|socket|timed out/i.test(error instanceof Error ? error.message : '')
  }

  private retryDelay(attempt: number, retryAfter?: string | null) {
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1_000)
    return Math.min(4_000, 500 * 2 ** attempt)
  }

  private delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
}
