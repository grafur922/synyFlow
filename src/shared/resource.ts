export type ResourceType = 'task' | 'note' | 'rss_item' | 'blog_post' | 'trip' | 'document'
export type ResourceSource = 'terra' | 'xiaomi' | 'rss' | 'blog' | 'travel' | 'upload'
export type ResourcePrivacy = 'public' | 'private' | 'secret'
export type ResourceSyncMode = 'full' | 'incremental'
export type ResourceConflictReason = 'same_revision_diverged' | 'source_revision_regressed'
export type ResourceConflictResolution = 'keep_current' | 'accept_incoming'

export interface ResourceLocationContext {
  name: string
  address?: string
  latitude?: number
  longitude?: number
}

export interface ResourceTimeContext {
  startAt?: number
  endAt?: number
  startDate?: string
  endDate?: string
  timezone?: string
}

export interface ResourceContext {
  projects: string[]
  time?: ResourceTimeContext
  locations: ResourceLocationContext[]
}

export interface ResourceSummary {
  id: string
  type: ResourceType
  source: ResourceSource
  sourceId: string
  title: string
  summary: string
  tags: string[]
  privacy: ResourcePrivacy
  context: ResourceContext
  archived: boolean
  deleted: boolean
  deletedAt?: number
  createdAt: number
  updatedAt: number
  indexedAt: number
  metadata: Record<string, unknown>
}

export interface Resource extends ResourceSummary {
  content: string
}

export interface ResourceSearchResult extends ResourceSummary {
  score: number
  highlights: string[]
}

export interface ResourceSyncCheckpointSummary {
  id: string
  source: ResourceSource
  type: ResourceType
  cursorPresent: boolean
  cursorUpdatedAt?: number
  state: 'idle' | 'running' | 'failed'
  revision: number
  consecutiveFailures: number
  lastMode?: ResourceSyncMode
  lastStartedAt?: number
  lastCompletedAt?: number
  lastFullScanAt?: number
  nextFullScanAt?: number
  lastError?: string
}

export interface ResourceConflictSummary {
  id: string
  resourceId: string
  source: ResourceSource
  type: ResourceType
  reason: ResourceConflictReason
  detectedAt: number
  current: ResourceSummary
  incoming: ResourceSummary
  status: 'unresolved' | 'resolved'
  resolution?: ResourceConflictResolution
  resolvedAt?: number
}

export interface ResourceConflictVersion extends Omit<ResourceConflictSummary, 'current' | 'incoming'> {
  current: Resource
  incoming: Resource
}

export interface ResourceStoreStatus {
  available: boolean
  encryptedAtRest: boolean
  encryptionConfigured: boolean
  format: string
  message: string
  maxResources: number
  resourceCount: number
  storedResourceCount: number
  tombstoneCount: number
  contextCoverage: number
  supportedTypes: ResourceType[]
  syncStorage: {
    available: boolean
    encryptedAtRest: boolean
    encryptionConfigured: boolean
    format: string
    message: string
  }
  syncCheckpoints: ResourceSyncCheckpointSummary[]
  conflictCount: number
  unresolvedConflictCount: number
  xiaomiSync?: {
    startedAt: number
    completedAt?: number
    state: 'running' | 'completed' | 'failed'
    mode: ResourceSyncMode
    pages: number
    indexed: number
    tombstoned: number
    fetchedDetails: number
    conflicts: number
    cursorAdvanced: boolean
    error?: string
  }
}
