import type { ResourcePrivacy } from '../resources/resource.model'

export type RagPrivacy = ResourcePrivacy
export type RagMimeType = 'text/plain' | 'text/markdown' | 'application/json' | 'text/csv'
export type RagDocumentSource = 'manual' | 'file' | 'resource' | 'xiaomi-note'
export type RagRisk = 'none' | 'medium' | 'high'
export type RagConfidence = 'none' | 'low' | 'medium' | 'high'
export type RagQueryProvider = 'local' | 'external'
export type RagVectorState = 'disabled' | 'pending' | 'ready' | 'failed' | 'local-only'
export type RagSyncEntryState = 'active' | 'pending' | 'failed' | 'deleted'
export type RagSyncRunState = 'idle' | 'scanning' | 'indexing' | 'cancelling' | 'failed'

export interface RagSensitiveFinding {
  id: string
  type: string
  severity: 'low' | 'medium' | 'high'
  message: string
  start: number
  end: number
  preview: string
}

export interface RagInjectionFinding {
  id: string
  severity: 'medium' | 'high'
  type: string
  message: string
  start: number
  end: number
}

export type SparseEmbedding = Array<[index: number, value: number]>

export interface RagDocument {
  id: string
  title: string
  content: string
  contentHash: string
  summary: string
  tags: string[]
  privacy: RagPrivacy
  mimeType: RagMimeType
  source: RagDocumentSource
  sourceResourceId?: string
  sourceItemId?: string
  sourceRevision?: string
  sourceManaged?: boolean
  /** User-controlled tags are kept when a source refreshes its automatic tags. */
  userTags?: string[]
  vectorState?: RagVectorState
  vectorVersion?: string
  originalFilename?: string
  sensitiveFindings: RagSensitiveFinding[]
  injectionFindings: RagInjectionFinding[]
  chunkCount: number
  createdAt: number
  updatedAt: number
  indexedAt: number
}

export interface RagChunk {
  id: string
  documentId: string
  index: number
  heading: string
  text: string
  startOffset: number
  endOffset: number
  contentHash: string
  terms: Record<string, number>
  tokenCount: number
  vector: SparseEmbedding
  injectionRisk: RagRisk
  injectionSignals: string[]
}

export interface RagSyncLedgerEntry {
  source: 'xiaomi-note'
  sourceItemId: string
  ragDocumentId: string
  remoteModifyDate: number
  remoteTag?: string
  contentHash: string
  lastSeenGeneration: string
  lastSeenAt: number
  lastIndexedAt?: number
  state: RagSyncEntryState
  lastError?: string
  retryCount: number
}

export interface RagSourceSyncStatus {
  source: 'xiaomi-note'
  state: RagSyncRunState
  startedAt?: number
  finishedAt?: number
  lastSuccessAt?: number
  currentPage?: number
  discovered: number
  processed: number
  created: number
  updated: number
  skipped: number
  deleted: number
  failed: number
  vectorized: number
  localOnly: number
  pendingAfterCurrent: boolean
  error?: string
}

export interface RagEmbeddingSettings {
  enabled: boolean
  provider: 'aliyun'
  baseUrl: string
  model: string
  dimensions: number
  batchSize: number
  concurrency: number
  timeoutMs: number
  retries: number
  autoSyncXiaomi: boolean
  xiaomiDefaultPrivacy: RagPrivacy
  autoRetry: boolean
  dailyTokenBudget?: number
  activeVectorVersion?: string
  pendingVectorVersion?: string
}

export const DEFAULT_RAG_EMBEDDING_SETTINGS: RagEmbeddingSettings = {
  enabled: false,
  provider: 'aliyun',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'text-embedding-v4',
  dimensions: 768,
  batchSize: 10,
  concurrency: 1,
  timeoutMs: 20_000,
  retries: 3,
  autoSyncXiaomi: true,
  xiaomiDefaultPrivacy: 'private',
  autoRetry: true
}

export interface RagState {
  version: 2
  revision: number
  documents: RagDocument[]
  chunks: RagChunk[]
  syncLedger: RagSyncLedgerEntry[]
  embeddingSettings: RagEmbeddingSettings
}

/** v1 is accepted only while migrating an existing encrypted RAG store. */
export interface LegacyRagState {
  version: 1
  revision: number
  documents: RagDocument[]
  chunks: RagChunk[]
}

export type RagDocumentSummary = Omit<RagDocument, 'content' | 'sensitiveFindings' | 'injectionFindings'> & {
  sensitiveFindingCount: number
  highSensitiveFindingCount: number
  injectionFindingCount: number
  highInjectionFindingCount: number
}

export interface CreateRagDocumentInput {
  title: string
  content: string
  tags?: string[]
  privacy?: RagPrivacy
  mimeType?: RagMimeType
  source?: RagDocumentSource
  originalFilename?: string
}

export interface UpdateRagDocumentInput {
  title?: string
  content?: string
  tags?: string[]
  privacy?: RagPrivacy
  mimeType?: RagMimeType
  originalFilename?: string
}

export interface RagQueryInput {
  query: string
  maxPrivacy?: RagPrivacy
  documentIds?: string[]
  limit?: number
  includeFlagged?: boolean
  provider?: RagQueryProvider
  externalConsent?: boolean
}

export interface RagCitation {
  number: number
  documentId: string
  documentTitle: string
  chunkId: string
  heading: string
  excerpt: string
  score: number
  keywordScore: number
  vectorScore: number
  privacy: RagPrivacy
  injectionRisk: RagRisk
  updatedAt: number
}

export interface RagQueryResult {
  query: string
  answer: string
  confidence: RagConfidence
  citations: RagCitation[]
  queryWarnings: RagInjectionFinding[]
  excluded: { privacy: number; flagged: number; sensitive: number; duplicate: number }
  provider: { mode: RagQueryProvider; embedding: string; answer: string; externalRequests: boolean; rerank?: string }
  generatedAt: number
  retrieval?: { mode: 'hybrid' | 'local'; reason?: string }
}
