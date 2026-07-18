export type BlogDraftStatus = 'draft' | 'published' | 'withdrawn'
export type BlogPrivacy = 'public' | 'private' | 'secret'
export type PrivacyFindingSeverity = 'high' | 'medium' | 'low'

export interface BlogDraft {
  id: string
  title: string
  slug: string
  content: string
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

export interface BlogState {
  drafts: BlogDraft[]
}

export interface PrivacyFinding {
  id: string
  type: string
  severity: PrivacyFindingSeverity
  message: string
  start: number
  end: number
  preview: string
}

export interface CreateBlogDraftInput {
  title: string
  slug?: string
  content?: string
  excerpt?: string
  tags?: string[]
  privacy?: BlogPrivacy
  sourceNoteId?: string
}

export type UpdateBlogDraftInput = Partial<Omit<CreateBlogDraftInput, 'sourceNoteId'>>
