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

export interface XiaomiConnectorStatus {
  configured: boolean
  writable: boolean
  mode: 'unconfigured' | 'ready' | 'readonly' | 'credentials_invalid' | 'circuit_open'
  credentialSource: 'environment' | 'windows-dpapi' | 'none'
  credentialWritable: boolean
  cacheTtlSeconds: number
  message: string
  retryAfterSeconds?: number
  consecutiveFailures: number
  audit: {
    retainedEvents: number
    lastEventAt?: number
    lastSuccessAt?: number
    lastFailureAt?: number
  }
  historyStorage?: XiaomiHistoryStorageStatus
}

export interface SaveXiaomiNoteInput {
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

export interface XiaomiNoteHistorySummary {
  id: string
  noteId: string
  title: string
  preview: string
  capturedAt: number
  sourceModifyDate: number
  reason: XiaomiNoteHistoryReason
}

export interface XiaomiNoteHistoryEntry extends XiaomiNoteHistorySummary {
  content: string
}


export interface XiaomiNoteHistoryArchiveItem {
  noteId: string
  title: string
  preview: string
  lastCapturedAt: number
  versionCount: number
  lastReason: XiaomiNoteHistoryReason
  deletedCandidate: boolean
}


export type NotePrivacyLevel = 'public' | 'private' | 'secret'

export interface XiaomiNoteMetadata {
  noteId: string
  favorite: boolean
  archived: boolean
  tags: string[]
  privacy: NotePrivacyLevel
  createdAt: number
  updatedAt: number
}

export interface UpdateXiaomiNoteMetadataInput {
  favorite?: boolean
  archived?: boolean
  tags?: string[]
  privacy?: NotePrivacyLevel
}
