import type { RagEmbeddingSettings } from '../rag.model'

export class UpdateRagSettingsDto implements Partial<RagEmbeddingSettings> {
  enabled?: boolean
  baseUrl?: string
  model?: string
  dimensions?: number
  batchSize?: number
  timeoutMs?: number
  autoSyncXiaomi?: boolean
  xiaomiDefaultPrivacy?: RagEmbeddingSettings['xiaomiDefaultPrivacy']
  autoRetry?: boolean
  dailyTokenBudget?: number
}
