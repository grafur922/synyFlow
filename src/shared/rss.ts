export interface RssSubscription {
  id: string
  url: string
  title: string
  siteUrl?: string
  description: string
  tags: string[]
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastFetchedAt?: number
  nextFetchAt?: number
  failureCount: number
  lastError?: string
  etag?: string
  lastModified?: string
}

export interface RssItemSummary {
  id: string
  subscriptionId: string
  guid: string
  title: string
  link?: string
  author?: string
  summary: string
  publishedAt?: number
  updatedAt?: number
  fetchedAt: number
  read: boolean
  favorite: boolean
  tags: string[]
  enclosure?: { url: string; type?: string; length?: number }
}

export interface RssItem extends RssItemSummary {
  content: string
}

export interface RssStatus {
  available: boolean
  encryptedAtRest: boolean
  encryptionConfigured: boolean
  format: string
  message: string
  subscriptionCount: number
  itemCount: number
  unreadCount: number
  schedulerEnabled: boolean
  resourceSyncError?: string
}
