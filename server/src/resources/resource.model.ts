export type ResourceType = 'task' | 'note' | 'rss_item' | 'blog_post' | 'trip' | 'document'
export type ResourceSource = 'terra' | 'xiaomi' | 'rss' | 'blog' | 'travel' | 'upload'
export type ResourcePrivacy = 'public' | 'private' | 'secret'
export type ResourceSyncMode = 'full' | 'incremental'
export type ResourceSyncStateValue = 'idle' | 'running' | 'failed'
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

export interface Resource {
  id: string
  type: ResourceType
  source: ResourceSource
  sourceId: string
  title: string
  summary: string
  content: string
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

export type ResourceSummary = Omit<Resource, 'content'>

export interface ResourceSearchResult extends ResourceSummary {
  score: number
  highlights: string[]
}

export interface ResourceSyncCheckpoint {
  id: string
  source: ResourceSource
  type: ResourceType
  cursor?: string
  cursorUpdatedAt?: number
  state: ResourceSyncStateValue
  revision: number
  consecutiveFailures: number
  lastMode?: ResourceSyncMode
  lastStartedAt?: number
  lastCompletedAt?: number
  lastFullScanAt?: number
  nextFullScanAt?: number
  lastError?: string
}

export interface ResourceConflictVersion {
  id: string
  resourceId: string
  source: ResourceSource
  type: ResourceType
  reason: ResourceConflictReason
  detectedAt: number
  currentFingerprint: string
  incomingFingerprint: string
  current: Resource
  incoming: Resource
  status: 'unresolved' | 'resolved'
  resolution?: ResourceConflictResolution
  resolvedAt?: number
}

export interface ResourceSyncState {
  version: 1
  checkpoints: ResourceSyncCheckpoint[]
  conflicts: ResourceConflictVersion[]
}

export type ResourceConflictPublicVersion = Omit<ResourceConflictVersion, 'currentFingerprint' | 'incomingFingerprint'>

export type ResourceConflictSummary = Omit<ResourceConflictPublicVersion, 'current' | 'incoming'> & {
  current: ResourceSummary
  incoming: ResourceSummary
}
