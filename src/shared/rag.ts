import type { ResourcePrivacy } from './resource'

export type RagPrivacy = ResourcePrivacy
export type RagMimeType = 'text/plain' | 'text/markdown' | 'application/json' | 'text/csv'
export type RagDocumentSource = 'manual' | 'file' | 'resource' | 'xiaomi-note'
export type RagRisk = 'none' | 'medium' | 'high'
export type RagConfidence = 'none' | 'low' | 'medium' | 'high'
export type RagQueryProvider = 'local' | 'external'
export type RagVectorState = 'disabled' | 'pending' | 'ready' | 'failed' | 'local-only'
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

export type RagDocumentSummary = Omit<RagDocument, 'content' | 'sensitiveFindings' | 'injectionFindings'> & {
  sensitiveFindingCount: number
  highSensitiveFindingCount: number
  injectionFindingCount: number
  highInjectionFindingCount: number
}

export interface RagEmbeddingCredentialStatus {
  configured: boolean
  source: 'environment' | 'windows-dpapi' | 'none'
  writable: boolean
  masked: string
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

export interface RagEmbeddingStatus {
  id: string
  enabled: boolean
  configured: boolean
  credential: RagEmbeddingCredentialStatus
  model: string
  dimensions: number
  baseUrl: string
  version: string
  usage: { day: string; usedTokens: number; budgetTokens?: number; remainingTokens?: number }
  lastSuccessAt?: number
  lastFailureAt?: number
  lastError?: string
  message: string
}

export interface RagVectorStoreStatus {
  available: boolean
  packageInstalled: boolean
  path: string
  activeVersion?: string
  pendingVersion?: string
  namespaces: string[]
  message: string
  lastError?: string
}

export interface RagVectorCoverage {
  ready: number
  pending: number
  failed: number
  localOnly: number
}

export interface RagSettingsResult {
  settings: RagEmbeddingSettings
  storedSettings: RagEmbeddingSettings
  environmentOverrides: string[]
  credential: RagEmbeddingCredentialStatus
  embeddingVersion: string
}

export interface RagVectorIndexStatus {
  store: RagVectorStoreStatus
  settings: RagEmbeddingSettings
  coverage: RagVectorCoverage
}

export interface XiaomiRagSyncStatus {
  accepted?: boolean
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
  ledger: { active: number; failed: number; deleted: number }
}

export interface RagStatus {
  available: boolean
  encryptedAtRest: boolean
  encryptionConfigured: boolean
  format: string
  message: string
  documentCount: number
  chunkCount: number
  uniqueChunkCount: number
  flaggedChunkCount: number
  sensitiveFindingCount: number
  maxDocuments: number
  maxDocumentCharacters: number
  revision: number
  embeddingProvider: string
  embeddingLocal: boolean
  externalRequests: boolean
  externalProvider: { configured: boolean; id: string; embeddingModel?: string; answerModel?: string; message: string }
  denseEmbedding: RagEmbeddingStatus
  vectorStore: RagVectorStoreStatus
  vectorCoverage: RagVectorCoverage
  resourceSyncError?: string
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
  provider: { mode: RagQueryProvider; embedding: string; answer: string; externalRequests: boolean }
  retrieval?: { mode: 'hybrid' | 'local'; reason?: string }
  generatedAt: number
}
