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

export interface RssItem {
  id: string
  subscriptionId: string
  guid: string
  title: string
  link?: string
  author?: string
  summary: string
  content: string
  publishedAt?: number
  updatedAt?: number
  fetchedAt: number
  read: boolean
  favorite: boolean
  tags: string[]
  enclosure?: { url: string; type?: string; length?: number }
}

export interface RssState {
  subscriptions: RssSubscription[]
  items: RssItem[]
}

export interface ParsedFeed {
  title: string
  siteUrl?: string
  description: string
  items: Array<Omit<RssItem, 'id' | 'subscriptionId' | 'fetchedAt' | 'read' | 'favorite' | 'tags'>>
}


export interface CreateRssSubscriptionInput {
  url: string
  title?: string
  tags?: string[]
  enabled?: boolean
  fetchNow?: boolean
}

export interface UpdateRssSubscriptionInput {
  url?: string
  title?: string
  tags?: string[]
  enabled?: boolean
}

export interface UpdateRssItemInput {
  read?: boolean
  favorite?: boolean
  tags?: string[]
}
