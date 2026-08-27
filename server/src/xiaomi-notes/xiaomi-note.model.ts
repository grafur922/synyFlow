export interface XiaomiRawNoteEntry {
  id: string
  tag: string
  type?: string
  status?: string
  subject?: string
  snippet?: string
  content?: string
  extraInfo?: string
  createDate: number
  modifyDate: number
  colorId?: number
  folderId?: string | number
  alertDate?: number
  setting?: Record<string, unknown>
}

export interface XiaomiNote {
  id: string
  tag: string
  title: string
  preview: string
  content?: string
  createDate: number
  modifyDate: number
  colorId: number
  folderId: string
  status: string
  hasRichFormatting: boolean
}

export interface XiaomiNoteFolder {
  id: string
  title: string
  createDate: number
  modifyDate: number
}

export interface XiaomiNotePage {
  notes: XiaomiNote[]
  folders: XiaomiNoteFolder[]
  syncCursor?: string
  nextCursor?: string
  lastPage: boolean
  cached: boolean
}

export interface XiaomiNotesLocalCache {
  notes: XiaomiNote[]
  folders: XiaomiNoteFolder[]
  syncTag?: string
  lastSyncAt?: number
}

export interface XiaomiHistoryStorageStatus {
  available: boolean
  encryptedAtRest: boolean
  encryptionConfigured: boolean
  migrationPending: boolean
  format: 'new' | 'plain' | 'encrypted' | 'sqlite' | 'unreadable'
  backend?: 'sqlite'
  rowEncryption?: 'aes-256-gcm'
  lookupIndex?: 'hmac-sha256'
  entryCount?: number
  migratedFrom?: 'plain' | 'encrypted'
  message: string
}

export type XiaomiConnectorMode = 'unconfigured' | 'ready' | 'readonly' | 'credentials_invalid' | 'circuit_open'

export interface XiaomiConnectorAuditStatus {
  retainedEvents: number
  lastEventAt?: number
  lastSuccessAt?: number
  lastFailureAt?: number
}

export interface XiaomiConnectorStatus {
  configured: boolean
  writable: boolean
  mode: XiaomiConnectorMode
  credentialSource: 'environment' | 'windows-dpapi' | 'none'
  credentialWritable: boolean
  cacheTtlSeconds: number
  message: string
  retryAfterSeconds?: number
  consecutiveFailures: number
  audit: XiaomiConnectorAuditStatus
  historyStorage?: XiaomiHistoryStorageStatus
  passportRefresh: {
    configured: boolean
    source: 'environment' | 'windows-dpapi' | 'none'
    writable: boolean
    available: boolean
    refreshing: boolean
    lastSuccessAt?: number
    lastFailureAt?: number
    message: string
  }
}

export interface XiaomiNoteInput {
  title: string
  content: string
}

export type XiaomiNoteHistoryReason =
  | 'created'
  | 'manual'
  | 'before_update'
  | 'before_delete'
  | 'before_restore'
  | 'restored'

export interface XiaomiNoteHistoryEntry {
  id: string
  noteId: string
  title: string
  content: string
  preview: string
  capturedAt: number
  sourceModifyDate: number
  reason: XiaomiNoteHistoryReason
}

export type XiaomiNoteHistorySummary = Omit<XiaomiNoteHistoryEntry, 'content'>


export interface XiaomiNoteHistoryArchiveItem {
  noteId: string
  title: string
  preview: string
  lastCapturedAt: number
  versionCount: number
  lastReason: XiaomiNoteHistoryReason
  deletedCandidate: boolean
}
