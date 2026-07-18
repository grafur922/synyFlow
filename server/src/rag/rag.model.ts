import type { ResourcePrivacy } from '../resources/resource.model'

export type RagPrivacy = ResourcePrivacy
export type RagMimeType = 'text/plain' | 'text/markdown' | 'application/json' | 'text/csv'
export type RagDocumentSource = 'manual' | 'file' | 'resource'
export type RagRisk = 'none' | 'medium' | 'high'
export type RagConfidence = 'none' | 'low' | 'medium' | 'high'
export type RagQueryProvider = 'local' | 'external'

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

export interface RagState {
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
  provider: { mode: RagQueryProvider; embedding: string; answer: string; externalRequests: boolean }
  generatedAt: number
}
