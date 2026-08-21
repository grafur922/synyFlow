import type { RagPrivacy, RagRisk } from './rag.model'

export interface DenseVectorRecord {
  chunkId: string
  documentId: string
  contentHash: string
  privacy: Exclude<RagPrivacy, 'secret'>
  injectionRisk: RagRisk
  vectorVersion: string
  vector: number[]
}

export interface DenseVectorSearchOptions {
  limit: number
  documentIds?: string[]
  maxPrivacy: RagPrivacy
  includeFlagged: boolean
}

export interface DenseVectorMatch {
  chunkId: string
  documentId: string
  distance: number
  score: number
}

export interface VectorStoreStatus {
  available: boolean
  packageInstalled: boolean
  path: string
  activeVersion?: string
  pendingVersion?: string
  namespaces: string[]
  message: string
  lastError?: string
}

export interface VectorStore {
  getStatus(): Promise<VectorStoreStatus>
  upsert(version: string, records: DenseVectorRecord[]): Promise<void>
  search(version: string, query: number[], options: DenseVectorSearchOptions): Promise<DenseVectorMatch[]>
  deleteByDocumentIds(version: string, documentIds: string[]): Promise<void>
  deleteByChunkIds(version: string, chunkIds: string[]): Promise<void>
  clearVersion(version: string): Promise<void>
  activateVersion(version: string): Promise<void>
}
