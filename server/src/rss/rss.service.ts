import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ResourcesService } from '../resources/resources.service'
import type { Resource } from '../resources/resource.model'
import { EncryptedJsonStore } from '../storage/encrypted-json.store'
import { getDataEncryptionSecret } from '../security/secrets'
import { parseFeedXml } from './rss-parser'
import type {
  CreateRssSubscriptionInput,
  ParsedFeed,
  RssItem,
  RssState,
  RssSubscription,
  UpdateRssItemInput,
  UpdateRssSubscriptionInput
} from './rss.model'
import { SafeFeedFetcher } from './safe-feed-fetcher'

const MAX_SUBSCRIPTIONS = 2_000
const MAX_ITEMS = 50_000
const MAX_ITEMS_PER_SUBSCRIPTION = 5_000
const MAX_TAGS = 20
const MAX_TAG_LENGTH = 64
const DEFAULT_FETCH_INTERVAL_MS = 60 * 60 * 1_000
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1_000

@Injectable()
export class RssService implements OnModuleInit, OnModuleDestroy {
  private readonly store: EncryptedJsonStore<RssState>
  private readonly fetcher = new SafeFeedFetcher()
  private readonly fetchLocks = new Map<string, Promise<unknown>>()
  private scheduler?: NodeJS.Timeout
  private initialTimer?: NodeJS.Timeout
  private fetchAllRunning = false
  private resourceSyncError = ''

  constructor(private readonly resourcesService: ResourcesService) {
    const encryptionSecret = getDataEncryptionSecret()
    this.store = new EncryptedJsonStore<RssState>({
      filePath: process.env.TERRA_RSS_FILE || join(process.cwd(), 'data', 'rss.json'),
      encryptionSecret,
      encryptedFormat: 'terra-rss-state',
      defaultValue: () => ({ subscriptions: [], items: [] }),
      validate: (value): value is RssState => this.isState(value),
      maxPlaintextBytes: 128 * 1024 * 1024
    })
    void this.store.initialize()
  }

  onModuleInit() {
    if (process.env.TERRA_RSS_SCHEDULER_ENABLED === 'false') return
    this.initialTimer = setTimeout(() => { void this.fetchDueSubscriptions() }, 15_000)
    this.initialTimer.unref()
    this.scheduler = setInterval(() => { void this.fetchDueSubscriptions() }, SCHEDULER_INTERVAL_MS)
    this.scheduler.unref()
  }

  onModuleDestroy() {
    if (this.initialTimer) clearTimeout(this.initialTimer)
    if (this.scheduler) clearInterval(this.scheduler)
  }

  async getStatus() {
    const state = await this.store.read()
    return {
      ...this.store.getStatus(),
      subscriptionCount: state.subscriptions.length,
      itemCount: state.items.length,
      unreadCount: state.items.filter((item) => !item.read).length,
      schedulerEnabled: process.env.TERRA_RSS_SCHEDULER_ENABLED !== 'false',
      resourceSyncError: this.resourceSyncError || undefined
    }
  }

  async findSubscriptions() {
    const state = await this.store.read()
    return [...state.subscriptions].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  }

  async findSubscription(id: string) {
    const state = await this.store.read()
    return this.requireSubscription(state, id)
  }

  async createSubscription(input: CreateRssSubscriptionInput) {
    const url = this.normalizeUrl(input.url)
    const tags = this.normalizeTags(input.tags || [])
    const existing = await this.store.read()
    if (existing.subscriptions.some((item) => item.url === url)) throw new BadRequestException('RSS subscription already exists')
    if (existing.subscriptions.length >= MAX_SUBSCRIPTIONS) throw new BadRequestException('RSS subscription limit reached')

    const id = randomUUID()
    const now = Date.now()
    let feed: ParsedFeed | undefined
    let fetchMeta: { finalUrl: string; etag?: string; lastModified?: string } | undefined
    if (input.fetchNow !== false) {
      const response = await this.fetcher.fetch(url)
      if (response.status !== 200 || !response.body) throw new BadRequestException('RSS endpoint returned no feed body')
      feed = parseFeedXml(response.body)
      fetchMeta = response
    }

    const subscription: RssSubscription = {
      id,
      url,
      title: this.cleanTitle(input.title) || feed?.title || new URL(url).hostname,
      siteUrl: feed?.siteUrl,
      description: feed?.description || '',
      tags,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
      lastFetchedAt: feed ? now : undefined,
      nextFetchAt: now + DEFAULT_FETCH_INTERVAL_MS,
      failureCount: 0,
      etag: fetchMeta?.etag,
      lastModified: fetchMeta?.lastModified
    }
    const items = feed ? this.materializeItems(subscription, feed, [], now) : []

    await this.store.update((state) => {
      state.subscriptions.push(subscription)
      state.items.push(...items)
      this.trimState(state)
    })
    await this.syncResourceIndex()
    return { subscription, importedItems: items.length }
  }

  async updateSubscription(id: string, input: UpdateRssSubscriptionInput) {
    const safeId = this.assertUuid(id)
    let updated!: RssSubscription
    await this.store.update((state) => {
      const index = state.subscriptions.findIndex((item) => item.id === safeId)
      if (index < 0) throw new NotFoundException('RSS subscription was not found')
      const current = state.subscriptions[index]
      const nextUrl = input.url === undefined ? current.url : this.normalizeUrl(input.url)
      if (state.subscriptions.some((item) => item.id !== safeId && item.url === nextUrl)) throw new BadRequestException('RSS subscription already exists')
      updated = {
        ...current,
        url: nextUrl,
        title: input.title === undefined ? current.title : (this.cleanTitle(input.title) || new URL(nextUrl).hostname),
        tags: input.tags === undefined ? current.tags : this.normalizeTags(input.tags),
        enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
        updatedAt: Date.now(),
        ...(nextUrl !== current.url ? { etag: undefined, lastModified: undefined, nextFetchAt: Date.now() } : {})
      }
      state.subscriptions[index] = updated
    })
    await this.syncResourceIndex()
    return updated
  }

  async removeSubscription(id: string) {
    const safeId = this.assertUuid(id)
    let removed = false
    await this.store.update((state) => {
      const nextSubscriptions = state.subscriptions.filter((item) => item.id !== safeId)
      removed = nextSubscriptions.length !== state.subscriptions.length
      if (!removed) throw new NotFoundException('RSS subscription was not found')
      state.subscriptions = nextSubscriptions
      state.items = state.items.filter((item) => item.subscriptionId !== safeId)
    })
    await this.syncResourceIndex()
    return { id: safeId, removed }
  }

  fetchSubscription(id: string) {
    const safeId = this.assertUuid(id)
    const existing = this.fetchLocks.get(safeId)
    if (existing) return existing
    const operation = this.performFetch(safeId).finally(() => this.fetchLocks.delete(safeId))
    this.fetchLocks.set(safeId, operation)
    return operation
  }

  async fetchDueSubscriptions(force = false) {
    if (this.fetchAllRunning) return { skipped: true, reason: 'RSS fetch is already running' }
    this.fetchAllRunning = true
    try {
      const state = await this.store.read()
      const now = Date.now()
      const due = state.subscriptions.filter((item) => item.enabled && (force || !item.nextFetchAt || item.nextFetchAt <= now))
      const results: Array<{ id: string; ok: boolean; result?: unknown; error?: string }> = []
      await this.mapConcurrent(due, 3, async (subscription) => {
        try { results.push({ id: subscription.id, ok: true, result: await this.fetchSubscription(subscription.id) }) }
        catch (error) { results.push({ id: subscription.id, ok: false, error: this.errorMessage(error) }) }
      })
      return { skipped: false, attempted: due.length, results }
    } finally {
      this.fetchAllRunning = false
    }
  }

  async findItems(options: { subscriptionId?: string; read?: string; favorite?: string; offset?: number; limit?: number }) {
    const state = await this.store.read()
    const subscriptionId = options.subscriptionId ? this.assertUuid(options.subscriptionId) : undefined
    const read = options.read === undefined ? undefined : options.read === 'true'
    const favorite = options.favorite === undefined ? undefined : options.favorite === 'true'
    const offset = this.normalizeOffset(options.offset)
    const limit = this.normalizeLimit(options.limit)
    const filtered = state.items
      .filter((item) => !subscriptionId || item.subscriptionId === subscriptionId)
      .filter((item) => read === undefined || item.read === read)
      .filter((item) => favorite === undefined || item.favorite === favorite)
      .sort((a, b) => (b.publishedAt || b.updatedAt || b.fetchedAt) - (a.publishedAt || a.updatedAt || a.fetchedAt))
    return { items: filtered.slice(offset, offset + limit).map((item) => this.toItemSummary(item)), total: filtered.length, offset, limit }
  }

  async findItem(id: string) {
    const safeId = this.assertItemId(id)
    const state = await this.store.read()
    const item = state.items.find((entry) => entry.id === safeId)
    if (!item) throw new NotFoundException('RSS item was not found')
    return item
  }

  async updateItem(id: string, input: UpdateRssItemInput) {
    const safeId = this.assertItemId(id)
    let updated!: RssItem
    await this.store.update((state) => {
      const index = state.items.findIndex((item) => item.id === safeId)
      if (index < 0) throw new NotFoundException('RSS item was not found')
      const current = state.items[index]
      updated = {
        ...current,
        read: input.read === undefined ? current.read : Boolean(input.read),
        favorite: input.favorite === undefined ? current.favorite : Boolean(input.favorite),
        tags: input.tags === undefined ? current.tags : this.normalizeTags(input.tags)
      }
      state.items[index] = updated
    })
    await this.syncResourceIndex()
    return updated
  }

  private async performFetch(id: string) {
    const state = await this.store.read()
    const subscription = this.requireSubscription(state, id)
    try {
      const response = await this.fetcher.fetch(subscription.url, { etag: subscription.etag, lastModified: subscription.lastModified })
      const now = Date.now()
      if (response.status === 304) {
        await this.store.update((current) => {
          const target = this.requireSubscription(current, id)
          target.lastFetchedAt = now
          target.nextFetchAt = now + DEFAULT_FETCH_INTERVAL_MS
          target.failureCount = 0
          target.lastError = undefined
          target.etag = response.etag || target.etag
          target.lastModified = response.lastModified || target.lastModified
        })
        return { status: 304, imported: 0, unchanged: true }
      }

      const feed = parseFeedXml(response.body || '')
      let imported = 0
      let total = 0
      await this.store.update((current) => {
        const target = this.requireSubscription(current, id)
        const existingItems = current.items.filter((item) => item.subscriptionId === id)
        const materialized = this.materializeItems(target, feed, existingItems, now)
        const existingIds = new Set(existingItems.map((item) => item.id))
        imported = materialized.filter((item) => !existingIds.has(item.id)).length
        current.items = [...current.items.filter((item) => item.subscriptionId !== id), ...materialized]
        target.title = target.title || feed.title
        target.siteUrl = feed.siteUrl
        target.description = feed.description
        target.lastFetchedAt = now
        target.nextFetchAt = now + DEFAULT_FETCH_INTERVAL_MS
        target.failureCount = 0
        target.lastError = undefined
        target.etag = response.etag
        target.lastModified = response.lastModified
        target.updatedAt = now
        this.trimState(current)
        total = current.items.filter((item) => item.subscriptionId === id).length
      })
      await this.syncResourceIndex()
      return { status: 200, imported, total, unchanged: false }
    } catch (error) {
      const now = Date.now()
      await this.store.update((current) => {
        const target = this.requireSubscription(current, id)
        target.failureCount += 1
        target.lastError = this.errorMessage(error)
        target.lastFetchedAt = now
        target.nextFetchAt = now + this.failureBackoff(target.failureCount)
        target.updatedAt = now
      })
      throw error
    }
  }

  private materializeItems(subscription: RssSubscription, feed: ParsedFeed, existing: RssItem[], fetchedAt: number) {
    const existingById = new Map(existing.map((item) => [item.id, item]))
    const items = feed.items.map((item) => {
      const id = this.createItemId(subscription.id, item.guid)
      const previous = existingById.get(id)
      return {
        ...item,
        id,
        subscriptionId: subscription.id,
        fetchedAt,
        read: previous?.read || false,
        favorite: previous?.favorite || false,
        tags: previous?.tags || []
      } satisfies RssItem
    })
    return Array.from(new Map(items.map((item) => [item.id, item])).values())
      .sort((a, b) => (b.publishedAt || b.updatedAt || b.fetchedAt) - (a.publishedAt || a.updatedAt || a.fetchedAt))
      .slice(0, MAX_ITEMS_PER_SUBSCRIPTION)
  }

  private async syncResourceIndex() {
    try {
      const state = await this.store.read()
    const subscriptions = new Map(state.subscriptions.map((item) => [item.id, item]))
    const resources: Resource[] = state.items.map((item) => {
      const subscription = subscriptions.get(item.subscriptionId)
      const timestamp = item.publishedAt || item.updatedAt || item.fetchedAt
      return {
        id: `rss:rss_item:${item.id}`,
        type: 'rss_item',
        source: 'rss',
        sourceId: item.id,
        title: item.title,
        summary: item.summary,
        content: item.content,
        tags: Array.from(new Set([...(subscription?.tags || []), ...item.tags])),
        privacy: 'private',
        context: {
          projects: subscription?.title ? [subscription.title] : [],
          time: { startAt: timestamp, endAt: item.updatedAt || timestamp },
          locations: []
        },
        archived: false,
        deleted: false,
        createdAt: timestamp,
        updatedAt: item.updatedAt || timestamp,
        indexedAt: Date.now(),
        metadata: {
          subscriptionId: item.subscriptionId,
          feedTitle: subscription?.title || '',
          link: item.link,
          author: item.author,
          favorite: item.favorite,
          read: item.read,
          publishedAt: item.publishedAt
        }
      }
    })
      await this.resourcesService.replaceSourceResources('rss', 'rss_item', resources)
      this.resourceSyncError = ''
    } catch (error) {
      this.resourceSyncError = this.errorMessage(error)
      console.warn('RSS Resource index sync failed', this.resourceSyncError)
    }
  }

  private trimState(state: RssState) {
    if (state.subscriptions.length > MAX_SUBSCRIPTIONS) throw new BadRequestException('RSS subscription limit reached')
    if (state.items.length <= MAX_ITEMS) return
    state.items = [...state.items]
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(!b.read) - Number(!a.read) || (b.publishedAt || b.fetchedAt) - (a.publishedAt || a.fetchedAt))
      .slice(0, MAX_ITEMS)
  }

  private requireSubscription(state: RssState, id: string) {
    const safeId = this.assertUuid(id)
    const subscription = state.subscriptions.find((item) => item.id === safeId)
    if (!subscription) throw new NotFoundException('RSS subscription was not found')
    return subscription
  }

  private isState(value: unknown): value is RssState {
    const state = value as Partial<RssState>
    return Boolean(
      state && Array.isArray(state.subscriptions) && state.subscriptions.length <= MAX_SUBSCRIPTIONS && state.subscriptions.every((item) => this.isSubscription(item)) &&
      Array.isArray(state.items) && state.items.length <= MAX_ITEMS && state.items.every((item) => this.isItem(item))
    )
  }

  private isSubscription(value: unknown): value is RssSubscription {
    const item = value as Partial<RssSubscription>
    return Boolean(item && typeof item.id === 'string' && typeof item.url === 'string' && typeof item.title === 'string' && typeof item.description === 'string' && Array.isArray(item.tags) && typeof item.enabled === 'boolean' && typeof item.createdAt === 'number' && typeof item.updatedAt === 'number' && typeof item.failureCount === 'number')
  }

  private isItem(value: unknown): value is RssItem {
    const item = value as Partial<RssItem>
    return Boolean(item && typeof item.id === 'string' && typeof item.subscriptionId === 'string' && typeof item.guid === 'string' && typeof item.title === 'string' && typeof item.summary === 'string' && typeof item.content === 'string' && item.content.length <= 200_000 && typeof item.fetchedAt === 'number' && typeof item.read === 'boolean' && typeof item.favorite === 'boolean' && Array.isArray(item.tags))
  }

  private normalizeUrl(value: string) {
    if (typeof value !== 'string') throw new BadRequestException('RSS URL is required')
    let url: URL
    try { url = new URL(value.trim()) } catch { throw new BadRequestException('Invalid RSS URL') }
    url.hash = ''
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException('RSS URL must use HTTP or HTTPS')
    if (url.username || url.password) throw new BadRequestException('RSS URL credentials are not allowed')
    return url.toString()
  }

  private normalizeTags(values: string[]) {
    if (!Array.isArray(values)) throw new BadRequestException('Tags must be an array')
    const tags = Array.from(new Set(values.map((value) => {
      if (typeof value !== 'string') throw new BadRequestException('Tag must be text')
      const tag = value.trim().replace(/\s+/g, ' ')
      if (tag.length > MAX_TAG_LENGTH) throw new BadRequestException(`Tag cannot exceed ${MAX_TAG_LENGTH} characters`)
      return tag
    }).filter(Boolean)))
    if (tags.length > MAX_TAGS) throw new BadRequestException(`At most ${MAX_TAGS} tags are allowed`)
    return tags
  }

  private cleanTitle(value?: string) {
    if (value === undefined) return ''
    if (typeof value !== 'string') throw new BadRequestException('Title must be text')
    const title = value.trim()
    if (title.length > 300) throw new BadRequestException('Title cannot exceed 300 characters')
    return title
  }

  private createItemId(subscriptionId: string, guid: string) {
    return createHash('sha256').update(`${subscriptionId}\0${guid.slice(0, 2_000)}`).digest('hex')
  }

  private toItemSummary(item: RssItem) {
    const { content: _content, ...summary } = item
    return summary
  }

  private failureBackoff(failureCount: number) {
    return Math.min(24 * 60 * 60 * 1_000, 15 * 60 * 1_000 * 2 ** Math.min(7, Math.max(0, failureCount - 1)))
  }

  private assertUuid(value: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('Invalid RSS subscription id')
    return value
  }

  private assertItemId(value: string) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new BadRequestException('Invalid RSS item id')
    return value
  }

  private normalizeOffset(value?: number) {
    if (value === undefined) return 0
    if (!Number.isFinite(value)) throw new BadRequestException('Offset must be a number')
    return Math.max(0, Math.trunc(value))
  }

  private normalizeLimit(value?: number) {
    if (value === undefined) return 100
    if (!Number.isFinite(value)) throw new BadRequestException('Limit must be a number')
    return Math.max(1, Math.min(200, Math.trunc(value)))
  }

  private async mapConcurrent<T>(items: T[], concurrency: number, mapper: (item: T) => Promise<void>) {
    let index = 0
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const current = index++
        if (current >= items.length) return
        await mapper(items[current])
      }
    })
    await Promise.all(workers)
  }

  private errorMessage(error: unknown) {
    return (error instanceof Error ? error.message : 'Unknown RSS error').replace(/[\r\n]/g, ' ').slice(0, 240)
  }
}
