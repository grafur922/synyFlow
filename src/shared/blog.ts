export type BlogDraftStatus = 'draft' | 'published' | 'withdrawn'
export type BlogPrivacy = 'public' | 'private' | 'secret'
export type PrivacyFindingSeverity = 'high' | 'medium' | 'low'

export interface BlogDraftSummary {
  id: string
  title: string
  slug: string
  excerpt: string
  tags: string[]
  privacy: BlogPrivacy
  status: BlogDraftStatus
  sourceNoteId?: string
  createdAt: number
  updatedAt: number
  publishedAt?: number
  lastPublishedAt?: number
  publishedPath?: string
}

export interface BlogDraft extends BlogDraftSummary { content: string }
export interface PrivacyFinding { id: string; type: string; severity: PrivacyFindingSeverity; message: string; start: number; end: number; preview: string }
export interface BlogStatus {
  storage: { available: boolean; encryptedAtRest: boolean; encryptionConfigured: boolean; format: string; message: string }
  adapter: { type: string; configured: boolean; directoryName?: string; message: string }
  draftCount: number
  publishedCount: number
  resourceSyncError?: string
}
