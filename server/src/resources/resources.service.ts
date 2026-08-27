import { BadGatewayException, BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { EncryptedJsonStore } from '../storage/encrypted-json.store'
import { getDataEncryptionSecret } from '../security/secrets'
import { TasksService } from '../tasks/tasks.service'
import type { Task } from '../tasks/task.model'
import { XiaomiNoteMetadataService } from '../xiaomi-notes/xiaomi-note-metadata.service'
import type { XiaomiNote } from '../xiaomi-notes/xiaomi-note.model'
import type { XiaomiNoteMetadata } from '../xiaomi-notes/xiaomi-note-metadata.model'
import { XiaomiNotesService } from '../xiaomi-notes/xiaomi-notes.service'
import type {
  Resource,
  ResourceConflictResolution,
  ResourceConflictPublicVersion,
  ResourceConflictSummary,
  ResourceConflictVersion,
  ResourceContext,
  ResourceLocationContext,
  ResourcePrivacy,
  ResourceSearchResult,
  ResourceSource,
  ResourceSummary,
  ResourceSyncCheckpoint,
  ResourceSyncMode,
  ResourceSyncState,
  ResourceType
} from './resource.model'

const MAX_RESOURCES = 100_000
const MAX_RESOURCE_CONTENT = 200_000
const MAX_SYNC_NOTES = 5_000
const MAX_SYNC_PAGES = 1_000
const DETAIL_CONCURRENCY = 4
const MAX_TOMBSTONES_PER_SOURCE = 20_000
const MAX_SYNC_CHECKPOINTS = 50
const MAX_RESOURCE_CONFLICTS = 128
const XIAOMI_FULL_SCAN_INTERVAL_MS = readBoundedInteger('TERRA_RESOURCE_XIAOMI_FULL_SCAN_INTERVAL_MS', 24 * 60 * 60_000, 60_000, 30 * 24 * 60 * 60_000)
const RESOURCE_SYNC_INTERVAL_MS = readOptionalInterval('TERRA_RESOURCE_SYNC_INTERVAL_MS', 60_000, 24 * 60 * 60_000)
const RESOURCE_TYPES = new Set<ResourceType>(['task', 'note', 'rss_item', 'blog_post', 'trip', 'document'])
const RESOURCE_SOURCES = new Set<ResourceSource>(['terra', 'xiaomi', 'rss', 'blog', 'travel', 'upload'])
const PRIVACY_LEVELS = new Set<ResourcePrivacy>(['public', 'private', 'secret'])

@Injectable()
export class ResourcesService implements OnModuleInit, OnModuleDestroy {
  private readonly store: EncryptedJsonStore<Resource[]>
  private readonly syncStore: EncryptedJsonStore<ResourceSyncState>
  private syncScheduler?: NodeJS.Timeout
  private xiaomiSyncPromise?: Promise<Record<string, unknown>>
  private resolvingResourceConflict = false
  private lastXiaomiSync?: {
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

  constructor(
    private readonly tasksService: TasksService,
    private readonly xiaomiNotesService: XiaomiNotesService,
    private readonly metadataService: XiaomiNoteMetadataService
  ) {
    const encryptionSecret = getDataEncryptionSecret()
    const resourceFile = process.env.TERRA_RESOURCE_FILE || join(process.cwd(), 'data', 'resources.json')
    const syncFile = process.env.TERRA_RESOURCE_SYNC_FILE || join(dirname(resourceFile), 'resource-sync.json')
    this.store = new EncryptedJsonStore<Resource[]>({
      filePath: resourceFile,
      encryptionSecret,
      encryptedFormat: 'terra-resource-index',
      defaultValue: () => [],
      validate: (value): value is Resource[] => Array.isArray(value) && value.length <= MAX_RESOURCES && value.every((item) => this.isResource(item)),
      maxPlaintextBytes: 96 * 1024 * 1024
    })
    this.syncStore = new EncryptedJsonStore<ResourceSyncState>({
      filePath: syncFile,
      encryptionSecret,
      encryptedFormat: 'terra-resource-sync-state',
      defaultValue: () => ({ version: 1, checkpoints: [], conflicts: [] }),
      validate: (value): value is ResourceSyncState => this.isSyncState(value),
      maxPlaintextBytes: 64 * 1024 * 1024
    })
    void this.store.initialize()
    void this.syncStore.initialize()
  }

  onModuleInit() {
    if (!RESOURCE_SYNC_INTERVAL_MS) return
    this.syncScheduler = setInterval(() => { void this.runScheduledXiaomiSync() }, RESOURCE_SYNC_INTERVAL_MS)
    this.syncScheduler.unref()
  }

  onModuleDestroy() {
    if (this.syncScheduler) clearInterval(this.syncScheduler)
  }

  async getStatus() {
    const [resources, syncState] = await Promise.all([this.store.read(), this.syncStore.read()])
    return {
      ...this.store.getStatus(),
      syncStorage: this.syncStore.getStatus(),
      maxResources: MAX_RESOURCES,
      resourceCount: resources.filter((item) => !item.deleted).length,
      storedResourceCount: resources.length,
      tombstoneCount: resources.filter((item) => item.deleted).length,
      contextCoverage: resources.filter((item) => this.isContext(item.context)).length,
      supportedTypes: [...RESOURCE_TYPES],
      syncCheckpoints: syncState.checkpoints.map((checkpoint) => this.toCheckpointSummary(checkpoint)),
      conflictCount: syncState.conflicts.length,
      unresolvedConflictCount: syncState.conflicts.filter((conflict) => conflict.status === 'unresolved').length,
      xiaomiSync: this.lastXiaomiSync
    }
  }

  async findAll(options: { type?: string; source?: string; privacy?: string; archived?: string; tag?: string; project?: string; location?: string; fromDate?: string; toDate?: string; offset?: number; limit?: number }) {
    const resources = await this.store.read()
    const type = options.type ? this.assertType(options.type) : undefined
    const source = options.source ? this.assertSource(options.source) : undefined
    const privacy = options.privacy ? this.assertPrivacy(options.privacy) : undefined
    const archived = this.normalizeOptionalBoolean(options.archived, 'archived')
    const tag = this.cleanOptionalFilter(options.tag, 'tag')
    const project = this.cleanOptionalFilter(options.project, 'project')
    const location = this.cleanOptionalFilter(options.location, 'location')
    const range = this.normalizeDateRange(options.fromDate, options.toDate)
    const offset = this.normalizeOffset(options.offset)
    const limit = this.normalizeLimit(options.limit, 100)
    const filtered = resources
      .filter((item) => !item.deleted)
      .filter((item) => !type || item.type === type)
      .filter((item) => !source || item.source === source)
      .filter((item) => !privacy || item.privacy === privacy)
      .filter((item) => archived === undefined || item.archived === archived)
      .filter((item) => !tag || item.tags.some((value) => value.toLocaleLowerCase('zh-CN') === tag))
      .filter((item) => !project || this.contextOf(item).projects.some((value) => value.toLocaleLowerCase('zh-CN').includes(project)))
      .filter((item) => !location || this.contextOf(item).locations.some((value) => `${value.name} ${value.address || ''}`.toLocaleLowerCase('zh-CN').includes(location)))
      .filter((item) => this.matchesDateRange(item, range))
      .sort((a, b) => b.updatedAt - a.updatedAt)

    return {
      items: filtered.slice(offset, offset + limit).map((item) => this.toSummary(item)),
      total: filtered.length,
      offset,
      limit
    }
  }

  async findOne(id: string) {
    const safeId = this.assertResourceId(id)
    const resources = await this.store.read()
    const resource = resources.find((item) => item.id === safeId && !item.deleted)
    if (!resource) throw new NotFoundException('Resource was not found')
    return { ...resource, context: this.contextOf(resource) }
  }

  async findConflicts(statusValue = 'unresolved') {
    const status = this.assertConflictStatus(statusValue)
    const state = await this.syncStore.read()
    return state.conflicts
      .filter((conflict) => status === 'all' || conflict.status === status)
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .map((conflict) => this.toConflictSummary(conflict))
  }

  async findConflict(id: string) {
    const safeId = this.assertConflictId(id)
    const state = await this.syncStore.read()
    const conflict = state.conflicts.find((item) => item.id === safeId)
    if (!conflict) throw new NotFoundException('Resource conflict was not found')
    return this.toConflictDetail(conflict)
  }

  async resolveConflict(id: string, resolutionValue: string) {
    if (this.xiaomiSyncPromise || this.resolvingResourceConflict) throw new ConflictException('Wait for the active Resource version operation to finish')
    this.resolvingResourceConflict = true
    try {
      const safeId = this.assertConflictId(id)
      const resolution = this.assertConflictResolution(resolutionValue)
      const currentState = await this.syncStore.read()
      const conflict = currentState.conflicts.find((item) => item.id === safeId)
      if (!conflict) throw new NotFoundException('Resource conflict was not found')
      if (conflict.status === 'resolved') return this.toConflictDetail(conflict)

      if (resolution === 'accept_incoming') {
        await this.store.update((resources) => {
          const index = resources.findIndex((item) => item.id === conflict.resourceId && !item.deleted)
          if (index < 0) throw new ConflictException('The indexed Resource changed after this conflict was recorded')
          const current = resources[index]
          if (this.sourceFingerprint(current) !== conflict.currentFingerprint) {
            throw new ConflictException('The indexed Resource changed after this conflict was recorded')
          }
          resources[index] = {
            ...structuredClone(conflict.incoming),
            deleted: false,
            deletedAt: undefined,
            indexedAt: Date.now()
          }
        })
      }

      let resolved!: ResourceConflictVersion
      await this.syncStore.update((state) => {
        const index = state.conflicts.findIndex((item) => item.id === safeId)
        if (index < 0) throw new NotFoundException('Resource conflict was not found')
        resolved = {
          ...state.conflicts[index],
          status: 'resolved',
          resolution,
          resolvedAt: Date.now()
        }
        state.conflicts[index] = resolved
      })
      return this.toConflictDetail(resolved)
    } finally {
      this.resolvingResourceConflict = false
    }
  }

  async findFavoriteTravelResources(maxPrivacyValue = 'private') {
    const maxPrivacy = this.assertPrivacy(maxPrivacyValue)
    const [resources, metadata] = await Promise.all([this.store.read(), this.metadataService.findAll()])
    const noteMetadata = new Map(metadata.map((item) => [item.noteId, item]))
    return resources
      .map((item) => {
        if (item.source !== 'xiaomi' || item.type !== 'note') return item
        const current = noteMetadata.get(item.sourceId)
        return current ? { ...item, tags: [...current.tags], privacy: current.privacy, archived: current.archived, metadata: { ...item.metadata, favorite: current.favorite } } : item
      })
      .filter((item) => !item.deleted && !item.archived)
      .filter((item) => privacyWeight(item.privacy) <= privacyWeight(maxPrivacy))
      .filter((item) => (
        item.source === 'xiaomi' && item.type === 'note' && item.metadata.favorite === true
      ) || (
        item.source === 'rss' && item.type === 'rss_item' && item.metadata.favorite === true
      ))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => this.toSummary(item))
  }

  async search(query: string, options: { type?: string; source?: string; privacy?: string; maxPrivacy?: string; tag?: string; project?: string; location?: string; fromDate?: string; toDate?: string; limit?: number } = {}) {
    const q = this.cleanQuery(query)
    const type = options.type ? this.assertType(options.type) : undefined
    const source = options.source ? this.assertSource(options.source) : undefined
    const privacy = options.privacy ? this.assertPrivacy(options.privacy) : undefined
    const maxPrivacy = privacy ? undefined : this.assertPrivacy(options.maxPrivacy || 'private')
    const limit = this.normalizeLimit(options.limit, 30)
    const tagFilter = this.cleanOptionalFilter(options.tag, 'tag')
    const projectFilter = this.cleanOptionalFilter(options.project, 'project')
    const locationFilter = this.cleanOptionalFilter(options.location, 'location')
    const range = this.normalizeDateRange(options.fromDate, options.toDate)
    const tokens = q.toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean)
    const resources = await this.store.read()
    const results: ResourceSearchResult[] = []

    for (const resource of resources) {
      if (resource.deleted || resource.archived) continue
      if (type && resource.type !== type) continue
      if (source && resource.source !== source) continue
      if (privacy && resource.privacy !== privacy) continue
      if (maxPrivacy && privacyWeight(resource.privacy) > privacyWeight(maxPrivacy)) continue
      if (tagFilter && !resource.tags.some((value) => value.toLocaleLowerCase('zh-CN') === tagFilter)) continue
      const context = this.contextOf(resource)
      if (projectFilter && !context.projects.some((value) => value.toLocaleLowerCase('zh-CN').includes(projectFilter))) continue
      if (locationFilter && !context.locations.some((value) => `${value.name} ${value.address || ''}`.toLocaleLowerCase('zh-CN').includes(locationFilter))) continue
      if (!this.matchesDateRange(resource, range)) continue
      const title = resource.title.toLocaleLowerCase('zh-CN')
      const summary = resource.summary.toLocaleLowerCase('zh-CN')
      const content = resource.content.toLocaleLowerCase('zh-CN')
      const tags = resource.tags.join(' ').toLocaleLowerCase('zh-CN')
      const projects = context.projects.join(' ').toLocaleLowerCase('zh-CN')
      const locations = context.locations.map((item) => `${item.name} ${item.address || ''}`).join(' ').toLocaleLowerCase('zh-CN')
      let score = 0
      const highlights: string[] = []

      for (const token of tokens) {
        if (title.includes(token)) score += 8
        if (tags.includes(token)) score += 5
        if (projects.includes(token)) score += 6
        if (locations.includes(token)) score += 4
        if (summary.includes(token)) score += 3
        if (content.includes(token)) score += 1
      }
      if (score === 0) continue
      if (title.includes(q.toLocaleLowerCase('zh-CN'))) score += 5
      const excerpt = this.createExcerpt(resource.content || resource.summary, tokens)
      if (excerpt) highlights.push(excerpt)
      results.push({ ...this.toSummary(resource), score, highlights })
    }

    return results.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, limit)
  }

  async removeFromIndex(id: string) {
    const safeId = this.assertResourceId(id)
    let removed = false
    await this.store.update((resources) => {
      const next = resources.filter((item) => item.id !== safeId)
      removed = next.length !== resources.length
      return next
    })
    return { id: safeId, removed }
  }

  async replaceSourceResources(source: ResourceSource, type: ResourceType, incoming: Resource[]) {
    this.assertSource(source)
    this.assertType(type)
    if (incoming.length > MAX_RESOURCES) throw new BadRequestException('Resource batch is too large')
    const sanitizedBatch: Resource[] = []
    for (const raw of incoming) {
      if (raw.source !== source || raw.type !== type) continue
      const item = this.sanitizeResource(raw)
      sanitizedBatch.push(item)
    }
    const incomingIds = new Set(sanitizedBatch.map((item) => item.id))
    const now = Date.now()
    let tombstoned = 0
    await this.store.update((resources) => {
      const sourceResources = resources.filter((item) => item.source === source && item.type === type)
      const tombstones = sourceResources
        .filter((item) => !incomingIds.has(item.id) && !item.deleted)
        .map((item) => ({
          ...item,
          deleted: true,
          deletedAt: now,
          indexedAt: now
        }))
      tombstoned = tombstones.length
      const retainedTombstones = sourceResources
        .filter((item) => item.deleted && !incomingIds.has(item.id))
        .sort((a, b) => (b.deletedAt || b.indexedAt) - (a.deletedAt || a.indexedAt))
        .slice(0, MAX_TOMBSTONES_PER_SOURCE)
      const others = resources.filter((item) => !(item.source === source && item.type === type))
      const next = [...others, ...sanitizedBatch, ...tombstones, ...retainedTombstones]
      if (next.length > MAX_RESOURCES) throw new BadRequestException('Resource index limit reached')
      return next
    })
    return {
      source,
      type,
      indexed: sanitizedBatch.length,
      tombstoned
    }
  }

  private async upsertSourceResources(source: ResourceSource, type: ResourceType, incoming: Resource[]) {
    this.assertSource(source)
    this.assertType(type)
    if (incoming.length > MAX_RESOURCES) throw new BadRequestException('Resource batch is too large')
    const sanitizedBatch: Resource[] = []
    for (const raw of incoming) {
      if (raw.source !== source || raw.type !== type) continue
      const item = this.sanitizeResource(raw)
      sanitizedBatch.push(item)
    }
    const incomingById = new Map(sanitizedBatch.map((item) => [item.id, item]))
    await this.store.update((resources) => {
      const seen = new Set<string>()
      const next = resources.map((item) => {
        const replacement = incomingById.get(item.id)
        if (!replacement) return item
        seen.add(item.id)
        return replacement
      })
      for (const resource of sanitizedBatch) {
        if (!seen.has(resource.id)) next.push(resource)
      }
      if (next.length > MAX_RESOURCES) throw new BadRequestException('Resource index limit reached')
      return next
    })
  }

  private sanitizeResource(raw: Resource): Resource {
    const title = String(raw.title || '未命名资源').slice(0, 500)
    const summary = String(raw.summary || '').slice(0, 2000)
    const content = String(raw.content || '').slice(0, MAX_RESOURCE_CONTENT)
    const rawTags = Array.isArray(raw.tags) ? raw.tags : []
    const tags = rawTags.map((t) => String(t).slice(0, 64)).filter(Boolean)
    const privacy = PRIVACY_LEVELS.has(raw.privacy) ? raw.privacy : 'private'
    const rawStart = Number(raw.createdAt) || Date.now()
    const rawEnd = Number(raw.updatedAt) || rawStart
    const createdAt = Math.min(rawStart, rawEnd)
    const updatedAt = Math.max(rawStart, rawEnd)
    const indexedAt = Number(raw.indexedAt) || Date.now()

    const context: ResourceContext = {
      projects: Array.isArray(raw.context?.projects)
        ? raw.context!.projects.map((p) => String(p).trim().slice(0, 120)).filter(Boolean)
        : [],
      time: {
        startAt: createdAt,
        endAt: updatedAt
      },
      locations: Array.isArray(raw.context?.locations) ? raw.context!.locations : []
    }

    return {
      id: String(raw.id).slice(0, 300),
      type: raw.type,
      source: raw.source,
      sourceId: String(raw.sourceId || raw.id).slice(0, 200),
      title,
      summary,
      content,
      tags,
      privacy,
      context,
      archived: Boolean(raw.archived),
      deleted: Boolean(raw.deleted),
      deletedAt: raw.deletedAt ? Number(raw.deletedAt) : undefined,
      createdAt,
      updatedAt,
      indexedAt,
      metadata: this.isRecord(raw.metadata) ? raw.metadata : {}
    }
  }

  async syncTasks() {
    const tasks = await this.tasksService.findAll()
    const now = Date.now()
    const mapped = tasks.map((task) => this.taskToResource(task, now))
    const result = await this.replaceSourceResources('terra', 'task', mapped)
    return { ...result, source: 'terra', type: 'task', removed: result.tombstoned }
  }

  async syncXiaomiNotes(modeValue = 'auto'): Promise<Record<string, unknown>> {
    const requestedMode = this.assertSyncMode(modeValue)
    if (this.xiaomiSyncPromise || this.resolvingResourceConflict) throw new ConflictException('A Resource version operation is already running')
    const operation = this.performXiaomiSync(requestedMode)
    this.xiaomiSyncPromise = operation
    try {
      return await operation
    } finally {
      if (this.xiaomiSyncPromise === operation) this.xiaomiSyncPromise = undefined
    }
  }

  private async performXiaomiSync(requestedMode: 'auto' | ResourceSyncMode): Promise<Record<string, unknown>> {
    const startedAt = Date.now()
    const syncState = await this.syncStore.read()
    const previousCheckpoint = syncState.checkpoints.find((item) => item.id === 'xiaomi:note')
    const mode = this.resolveXiaomiSyncMode(requestedMode, previousCheckpoint, startedAt)
    const startCursor = mode === 'incremental' ? previousCheckpoint?.cursor : undefined
    if (mode === 'incremental' && !startCursor) throw new BadRequestException('A full Xiaomi sync is required before incremental sync')

    await this.beginXiaomiSync(mode, startedAt)
    this.lastXiaomiSync = {
      startedAt,
      state: 'running',
      mode,
      pages: 0,
      indexed: 0,
      tombstoned: 0,
      fetchedDetails: 0,
      conflicts: 0,
      cursorAdvanced: false
    }

    try {
      const scan = await this.scanXiaomiPages(startCursor)
      const existing = await this.store.read()
      const sourceResources = existing.filter((item) => item.source === 'xiaomi' && item.type === 'note')
      const existingBySourceId = new Map(sourceResources.map((item) => [item.sourceId, item]))
      const summaries = [...scan.summaryById.values()]
      const activeExistingCount = sourceResources.filter((item) => !item.deleted).length
      if (mode === 'full' && activeExistingCount > 0 && summaries.length === 0 && process.env.TERRA_XIAOMI_ALLOW_EMPTY_FULL_SYNC !== 'true') {
        throw new BadGatewayException('Xiaomi returned an empty full sync; index was left unchanged')
      }

      const metadata = await this.metadataService.findAll()
      const metadataById = new Map(metadata.map((item) => [item.noteId, item]))
      const changedSummaries = mode === 'incremental'
        ? summaries
        : summaries.filter((note) => this.xiaomiSummaryChanged(note, existingBySourceId.get(note.id)))
      // 限制单次详情抓取上限为 30 篇并优先复用本地缓存，避免一次性并发发送大量远端网络请求
      const detailCandidates = changedSummaries.slice(0, 30)
      const details = await this.mapConcurrent(detailCandidates, DETAIL_CONCURRENCY, (note) => this.xiaomiNotesService.findOne(note.id, false))
      const detailsById = new Map(details.map((note) => [note.id, note]))
      const indexedAt = Date.now()
      const mapped = summaries.map((summary) => {
        const detail = detailsById.get(summary.id)
        const previous = existingBySourceId.get(summary.id)
        return this.xiaomiNoteToResource(detail || summary, metadataById.get(summary.id), previous, indexedAt, scan.folderTitles.get(summary.folderId))
      })
      const reconciliation = this.reconcileXiaomiResources(mapped, existingBySourceId, indexedAt)
      let indexed = reconciliation.resources.length
      let removed = 0

      if (mode === 'full') {
        const currentIds = new Set(reconciliation.resources.map((item) => item.sourceId))
        removed = sourceResources.filter((item) => !item.deleted && !currentIds.has(item.sourceId)).length
        await this.replaceSourceResources('xiaomi', 'note', reconciliation.resources)
      } else {
        const upserts = new Map<string, Resource>()
        for (const previous of sourceResources) {
          if (previous.deleted) continue
          const patch = this.xiaomiMetadataPatch(previous, metadataById.get(previous.sourceId), indexedAt)
          if (patch) upserts.set(patch.id, patch)
        }
        for (const resource of reconciliation.resources) upserts.set(resource.id, resource)
        indexed = upserts.size
        if (upserts.size) await this.upsertSourceResources('xiaomi', 'note', [...upserts.values()])
      }

      const cursorAdvanced = previousCheckpoint?.cursor !== scan.finalCursor
      const completion = await this.completeXiaomiSync(mode, startedAt, scan.finalCursor, reconciliation.conflicts)
      this.lastXiaomiSync = {
        startedAt,
        completedAt: completion.completedAt,
        state: 'completed',
        mode,
        pages: scan.pages,
        indexed,
        tombstoned: removed,
        fetchedDetails: detailCandidates.length,
        conflicts: completion.recordedConflicts,
        cursorAdvanced
      }
      return {
        source: 'xiaomi',
        type: 'note',
        mode,
        pages: scan.pages,
        indexed,
        fetchedDetails: detailCandidates.length,
        conflicts: completion.recordedConflicts,
        cursorAdvanced,
        removed
      }
    } catch (error) {
      await this.failXiaomiSync(mode, startedAt, error).catch(() => undefined)
      this.lastXiaomiSync = {
        ...this.lastXiaomiSync!,
        completedAt: Date.now(),
        state: 'failed',
        error: this.errorMessage(error)
      }
      throw error
    }
  }

  async syncAll() {
    const results: Record<string, unknown> = {}
    const errors: Record<string, string> = {}
    try { results.tasks = await this.syncTasks() } catch (error) { errors.tasks = this.errorMessage(error) }
    try { results.xiaomiNotes = await this.syncXiaomiNotes() } catch (error) { errors.xiaomiNotes = this.errorMessage(error) }
    return { results, errors, completedAt: new Date().toISOString() }
  }

  private async runScheduledXiaomiSync() {
    if (this.xiaomiSyncPromise) return
    const connector = this.xiaomiNotesService.getStatus()
    if (!connector.configured || !['ready', 'readonly'].includes(connector.mode)) return
    await this.syncXiaomiNotes('auto').catch(() => undefined)
  }

  private resolveXiaomiSyncMode(requested: 'auto' | ResourceSyncMode, checkpoint: ResourceSyncCheckpoint | undefined, now: number): ResourceSyncMode {
    if (requested !== 'auto') return requested
    if (!checkpoint?.cursor || !checkpoint.lastFullScanAt) return 'full'
    return now >= checkpoint.lastFullScanAt + XIAOMI_FULL_SCAN_INTERVAL_MS ? 'full' : 'incremental'
  }

  private async scanXiaomiPages(startCursor?: string) {
    const summaryById = new Map<string, XiaomiNote>()
    const folderTitles = new Map<string, string>()
    const seenCursors = new Set<string>(startCursor ? [startCursor] : [])
    let cursor = startCursor
    let finalCursor: string | undefined
    let pages = 0

    while (pages < MAX_SYNC_PAGES) {
      const page = await this.xiaomiNotesService.findPage({ cursor, limit: 200, forceRefresh: true })
      pages += 1
      for (const note of page.notes) summaryById.set(note.id, note)
      for (const folder of page.folders) folderTitles.set(folder.id, folder.title)
      if (summaryById.size > MAX_SYNC_NOTES) throw new BadRequestException(`Xiaomi note sync exceeded ${MAX_SYNC_NOTES} notes`)
      if (page.lastPage) {
        finalCursor = page.syncCursor
        break
      }
      if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
        throw new BadGatewayException('Xiaomi note sync stopped before the final page')
      }
      seenCursors.add(page.nextCursor)
      cursor = page.nextCursor
    }

    if (pages >= MAX_SYNC_PAGES && !finalCursor) throw new BadGatewayException('Xiaomi note sync exceeded the page limit')
    if (!finalCursor) throw new BadGatewayException('Xiaomi note sync final page did not provide a persistent cursor')
    return { summaryById, folderTitles, finalCursor, pages }
  }

  private async beginXiaomiSync(mode: ResourceSyncMode, startedAt: number) {
    await this.syncStore.update((state) => {
      const current = state.checkpoints.find((item) => item.id === 'xiaomi:note')
      const checkpoint: ResourceSyncCheckpoint = {
        ...current,
        id: 'xiaomi:note',
        source: 'xiaomi',
        type: 'note',
        state: 'running',
        revision: (current?.revision || 0) + 1,
        consecutiveFailures: current?.consecutiveFailures || 0,
        lastMode: mode,
        lastStartedAt: startedAt,
        lastError: undefined
      }
      this.upsertSyncCheckpoint(state, checkpoint)
    })
  }

  private async completeXiaomiSync(mode: ResourceSyncMode, startedAt: number, cursor: string, conflicts: ResourceConflictVersion[]) {
    const completedAt = Date.now()
    let recordedConflicts = 0
    await this.syncStore.update((state) => {
      const current = state.checkpoints.find((item) => item.id === 'xiaomi:note')
      const lastFullScanAt = mode === 'full' ? completedAt : current?.lastFullScanAt
      const checkpoint: ResourceSyncCheckpoint = {
        ...current,
        id: 'xiaomi:note',
        source: 'xiaomi',
        type: 'note',
        cursor,
        cursorUpdatedAt: cursor === current?.cursor ? current.cursorUpdatedAt || completedAt : completedAt,
        state: 'idle',
        revision: (current?.revision || 0) + 1,
        consecutiveFailures: 0,
        lastMode: mode,
        lastStartedAt: startedAt,
        lastCompletedAt: completedAt,
        lastFullScanAt,
        nextFullScanAt: lastFullScanAt ? lastFullScanAt + XIAOMI_FULL_SCAN_INTERVAL_MS : undefined,
        lastError: undefined
      }
      this.upsertSyncCheckpoint(state, checkpoint)

      const existingKeys = new Set(state.conflicts.map((conflict) => this.conflictKey(conflict)))
      const additions = conflicts.filter((conflict) => {
        const key = this.conflictKey(conflict)
        if (existingKeys.has(key)) return false
        existingKeys.add(key)
        return true
      })
      recordedConflicts = additions.length
      const combined = [...additions, ...state.conflicts]
      const unresolved = combined.filter((conflict) => conflict.status === 'unresolved').sort((a, b) => b.detectedAt - a.detectedAt)
      if (unresolved.length > MAX_RESOURCE_CONFLICTS) {
        throw new ConflictException(`Resolve Resource conflicts before adding more than ${MAX_RESOURCE_CONFLICTS} versions`)
      }
      const resolved = combined.filter((conflict) => conflict.status === 'resolved').sort((a, b) => (b.resolvedAt || b.detectedAt) - (a.resolvedAt || a.detectedAt))
      state.conflicts = [...unresolved, ...resolved].slice(0, MAX_RESOURCE_CONFLICTS)
    })
    return { completedAt, recordedConflicts }
  }

  private async failXiaomiSync(mode: ResourceSyncMode, startedAt: number, error: unknown) {
    await this.syncStore.update((state) => {
      const current = state.checkpoints.find((item) => item.id === 'xiaomi:note')
      const checkpoint: ResourceSyncCheckpoint = {
        ...current,
        id: 'xiaomi:note',
        source: 'xiaomi',
        type: 'note',
        state: 'failed',
        revision: (current?.revision || 0) + 1,
        consecutiveFailures: (current?.consecutiveFailures || 0) + 1,
        lastMode: mode,
        lastStartedAt: startedAt,
        lastError: this.errorMessage(error)
      }
      this.upsertSyncCheckpoint(state, checkpoint)
    })
  }

  private upsertSyncCheckpoint(state: ResourceSyncState, checkpoint: ResourceSyncCheckpoint) {
    const index = state.checkpoints.findIndex((item) => item.id === checkpoint.id)
    if (index >= 0) state.checkpoints[index] = checkpoint
    else state.checkpoints.push(checkpoint)
    if (state.checkpoints.length > MAX_SYNC_CHECKPOINTS) throw new BadRequestException('Resource sync checkpoint limit reached')
  }

  private reconcileXiaomiResources(incoming: Resource[], existingBySourceId: Map<string, Resource>, indexedAt: number) {
    const resources: Resource[] = []
    const conflicts: ResourceConflictVersion[] = []
    for (const candidate of incoming) {
      const previous = existingBySourceId.get(candidate.sourceId)
      if (!previous || previous.deleted) {
        resources.push(candidate)
        continue
      }
      const current = this.mergeXiaomiLocalMetadata(previous, candidate, indexedAt)
      const currentFingerprint = this.sourceFingerprint(current)
      const incomingFingerprint = this.sourceFingerprint(candidate)
      if (currentFingerprint !== incomingFingerprint && candidate.updatedAt <= previous.updatedAt) {
        conflicts.push({
          id: randomUUID(),
          resourceId: candidate.id,
          source: 'xiaomi',
          type: 'note',
          reason: candidate.updatedAt < previous.updatedAt ? 'source_revision_regressed' : 'same_revision_diverged',
          detectedAt: indexedAt,
          currentFingerprint,
          incomingFingerprint,
          current: structuredClone(current),
          incoming: structuredClone(candidate),
          status: 'unresolved'
        })
        resources.push(current)
      } else if (candidate.updatedAt < previous.updatedAt) {
        resources.push(current)
      } else {
        resources.push(candidate)
      }
    }
    return { resources, conflicts }
  }

  private mergeXiaomiLocalMetadata(current: Resource, incoming: Resource, indexedAt: number): Resource {
    return {
      ...current,
      context: this.contextOf(current),
      tags: [...incoming.tags],
      privacy: incoming.privacy,
      archived: incoming.archived,
      indexedAt,
      metadata: {
        ...current.metadata,
        favorite: incoming.metadata.favorite
      }
    }
  }

  private xiaomiMetadataPatch(resource: Resource, metadata: XiaomiNoteMetadata | undefined, indexedAt: number) {
    const tags = metadata?.tags || []
    const privacy = metadata?.privacy || 'private'
    const archived = metadata?.archived || false
    const favorite = metadata?.favorite || false
    const unchanged = resource.privacy === privacy && resource.archived === archived && resource.metadata.favorite === favorite &&
      resource.tags.length === tags.length && resource.tags.every((tag, index) => tag === tags[index])
    if (unchanged) return undefined
    return {
      ...resource,
      context: this.contextOf(resource),
      tags: [...tags],
      privacy,
      archived,
      indexedAt,
      metadata: { ...resource.metadata, favorite }
    } satisfies Resource
  }

  private xiaomiSummaryChanged(note: XiaomiNote, previous: Resource | undefined) {
    return !previous || previous.deleted || previous.updatedAt !== note.modifyDate || previous.title !== note.title || previous.summary !== note.preview ||
      previous.metadata.folderId !== note.folderId || previous.metadata.colorId !== note.colorId || previous.metadata.status !== note.status ||
      previous.metadata.hasRichFormatting !== note.hasRichFormatting
  }

  private sourceFingerprint(resource: Resource) {
    if (resource.source === 'xiaomi' && resource.type === 'note') {
      const stored = resource.metadata.sourceFingerprint
      if (typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored)) return stored
      return this.calculateXiaomiSourceFingerprint(resource)
    }
    return createHash('sha256').update(JSON.stringify({
      type: resource.type,
      source: resource.source,
      sourceId: resource.sourceId,
      title: resource.title,
      summary: resource.summary,
      content: resource.content,
      tags: resource.tags,
      privacy: resource.privacy,
      context: this.contextOf(resource),
      archived: resource.archived,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
      metadata: resource.metadata
    })).digest('hex')
  }

  private calculateXiaomiSourceFingerprint(resource: Resource) {
    return createHash('sha256').update(JSON.stringify({
      title: resource.title,
      summary: resource.summary,
      content: resource.content,
      projects: this.contextOf(resource).projects,
      folderId: resource.metadata.folderId,
      colorId: resource.metadata.colorId,
      status: resource.metadata.status,
      hasRichFormatting: resource.metadata.hasRichFormatting
    })).digest('hex')
  }

  private conflictKey(conflict: ResourceConflictVersion) {
    return `${conflict.resourceId}:${conflict.currentFingerprint}:${conflict.incomingFingerprint}`
  }

  private toCheckpointSummary(checkpoint: ResourceSyncCheckpoint) {
    const { cursor, ...summary } = checkpoint
    return { ...summary, cursorPresent: Boolean(cursor) }
  }

  private toConflictSummary(conflict: ResourceConflictVersion): ResourceConflictSummary {
    const { currentFingerprint: _currentFingerprint, incomingFingerprint: _incomingFingerprint, ...visible } = conflict
    return {
      ...visible,
      current: this.toSummary(conflict.current),
      incoming: this.toSummary(conflict.incoming)
    }
  }

  private toConflictDetail(conflict: ResourceConflictVersion): ResourceConflictPublicVersion {
    const { currentFingerprint: _currentFingerprint, incomingFingerprint: _incomingFingerprint, ...visible } = conflict
    return structuredClone(visible)
  }

  private taskToResource(task: Task, now: number): Resource {
    const schedule = [task.date, task.timeStart, task.timeEnd].filter(Boolean).join(' ')
    return {
      id: `terra:task:${task.id}`,
      type: 'task',
      source: 'terra',
      sourceId: task.id,
      title: task.title,
      summary: this.compact(`${task.category} ${schedule} ${task.notes}`).slice(0, 300),
      content: task.notes,
      tags: [task.category, task.priority.toLocaleLowerCase('en-US')],
      privacy: 'private',
      context: {
        projects: [task.category],
        time: { startDate: task.date, endDate: task.date },
        locations: []
      },
      archived: task.completed,
      deleted: false,
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      metadata: {
        category: task.category,
        date: task.date,
        timeStart: task.timeStart,
        timeEnd: task.timeEnd,
        priority: task.priority,
        completed: task.completed
      }
    }
  }

  private xiaomiNoteToResource(note: XiaomiNote, metadata: XiaomiNoteMetadata | undefined, previous: Resource | undefined, now: number, folderTitle?: string): Resource {
    const previousContext = previous ? this.contextOf(previous) : undefined
    const title = (note.title || '未命名小米笔记').slice(0, 500)
    const summary = (note.preview || '').slice(0, 2000)
    const content = (note.content ?? previous?.content ?? '').slice(0, MAX_RESOURCE_CONTENT)

    const rawStart = Number(note.createDate) || Number(previousContext?.time?.startAt) || Number(previous?.createdAt) || now
    const rawEnd = Number(note.modifyDate) || Number(previousContext?.time?.endAt) || Number(previous?.updatedAt) || rawStart
    const startAt = Math.min(rawStart, rawEnd)
    const endAt = Math.max(rawStart, rawEnd)

    const rawTags = metadata?.tags || []
    const tags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).slice(0, 64)).filter(Boolean)
      : []

    const folderProject = folderTitle ? String(folderTitle).trim().slice(0, 120) : undefined
    const prevProjects = Array.isArray(previousContext?.projects)
      ? previousContext!.projects.map((p) => String(p).trim().slice(0, 120)).filter(Boolean)
      : []
    const projects = folderProject ? [folderProject] : prevProjects

    const resource: Resource = {
      id: `xiaomi:note:${note.id}`,
      type: 'note',
      source: 'xiaomi',
      sourceId: String(note.id),
      title,
      summary,
      content,
      tags,
      privacy: metadata?.privacy || 'private',
      context: {
        projects,
        time: {
          startAt,
          endAt
        },
        locations: []
      },
      archived: metadata?.archived || false,
      deleted: false,
      createdAt: startAt,
      updatedAt: endAt,
      indexedAt: now,
      metadata: {
        folderId: note.folderId,
        colorId: note.colorId,
        status: note.status,
        favorite: metadata?.favorite || false,
        hasRichFormatting: note.hasRichFormatting,
        sourceRevision: note.modifyDate
      }
    }
    const canReuseFingerprint = Boolean(
      previous && !this.xiaomiSummaryChanged(note, previous) &&
      (note.content === undefined || note.content === previous.content) &&
      typeof previous.metadata.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(previous.metadata.sourceFingerprint)
    )
    resource.metadata.sourceFingerprint = canReuseFingerprint
      ? previous!.metadata.sourceFingerprint
      : this.calculateXiaomiSourceFingerprint(resource)
    return resource
  }

  private toSummary(resource: Resource): ResourceSummary {
    const { content: _content, ...summary } = resource
    return { ...summary, context: this.contextOf(resource) }
  }

  private createExcerpt(value: string, tokens: string[]) {
    const compact = this.compact(value)
    if (!compact) return ''
    const lower = compact.toLocaleLowerCase('zh-CN')
    const positions = tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0)
    const start = positions.length ? Math.max(0, Math.min(...positions) - 50) : 0
    return compact.slice(start, start + 180)
  }

  private async mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
    const results = new Array<R>(items.length)
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = nextIndex++
        if (index >= items.length) return
        results[index] = await mapper(items[index])
      }
    })
    await Promise.all(workers)
    return results
  }

  private isResource(value: unknown): value is Resource {
    const item = value as Partial<Resource>
    return Boolean(
      item && typeof item.id === 'string' && item.id.length <= 300 &&
      typeof item.type === 'string' && RESOURCE_TYPES.has(item.type as ResourceType) &&
      typeof item.source === 'string' && RESOURCE_SOURCES.has(item.source as ResourceSource) &&
      typeof item.sourceId === 'string' && item.sourceId.length <= 200 &&
      typeof item.title === 'string' && item.title.length <= 500 &&
      typeof item.summary === 'string' && item.summary.length <= 2_000 &&
      typeof item.content === 'string' && item.content.length <= MAX_RESOURCE_CONTENT &&
      Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === 'string' && tag.length <= 64) &&
      typeof item.privacy === 'string' && PRIVACY_LEVELS.has(item.privacy as ResourcePrivacy) &&
      (item.context === undefined || this.isContext(item.context)) &&
      typeof item.archived === 'boolean' && typeof item.deleted === 'boolean' &&
      (item.deletedAt === undefined || typeof item.deletedAt === 'number' && Number.isFinite(item.deletedAt)) &&
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) &&
      typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) &&
      typeof item.indexedAt === 'number' && Number.isFinite(item.indexedAt) &&
      this.isRecord(item.metadata)
    )
  }

  private isSyncState(value: unknown): value is ResourceSyncState {
    const state = value as Partial<ResourceSyncState>
    if (!state || state.version !== 1 || !Array.isArray(state.checkpoints) || !Array.isArray(state.conflicts)) return false
    if (state.checkpoints.length > MAX_SYNC_CHECKPOINTS || state.conflicts.length > MAX_RESOURCE_CONFLICTS) return false
    if (!state.checkpoints.every((checkpoint) => this.isSyncCheckpoint(checkpoint))) return false
    if (!state.conflicts.every((conflict) => this.isResourceConflict(conflict))) return false
    if (new Set(state.checkpoints.map((checkpoint) => checkpoint.id)).size !== state.checkpoints.length) return false
    return new Set(state.conflicts.map((conflict) => conflict.id)).size === state.conflicts.length
  }

  private isSyncCheckpoint(value: unknown): value is ResourceSyncCheckpoint {
    const checkpoint = value as Partial<ResourceSyncCheckpoint>
    return Boolean(
      checkpoint && typeof checkpoint.id === 'string' && checkpoint.id === `${checkpoint.source}:${checkpoint.type}` &&
      typeof checkpoint.source === 'string' && RESOURCE_SOURCES.has(checkpoint.source as ResourceSource) &&
      typeof checkpoint.type === 'string' && RESOURCE_TYPES.has(checkpoint.type as ResourceType) &&
      (checkpoint.cursor === undefined || typeof checkpoint.cursor === 'string' && checkpoint.cursor.length <= 512 && !/\p{Cc}/u.test(checkpoint.cursor)) &&
      (checkpoint.cursorUpdatedAt === undefined || this.isTimestamp(checkpoint.cursorUpdatedAt)) &&
      typeof checkpoint.state === 'string' && ['idle', 'running', 'failed'].includes(checkpoint.state) &&
      Number.isSafeInteger(checkpoint.revision) && checkpoint.revision! >= 0 &&
      Number.isSafeInteger(checkpoint.consecutiveFailures) && checkpoint.consecutiveFailures! >= 0 && checkpoint.consecutiveFailures! <= 1_000_000 &&
      (checkpoint.lastMode === undefined || checkpoint.lastMode === 'full' || checkpoint.lastMode === 'incremental') &&
      [checkpoint.lastStartedAt, checkpoint.lastCompletedAt, checkpoint.lastFullScanAt, checkpoint.nextFullScanAt].every((timestamp) => timestamp === undefined || this.isTimestamp(timestamp)) &&
      (checkpoint.lastError === undefined || typeof checkpoint.lastError === 'string' && checkpoint.lastError.length <= 240)
    )
  }

  private isResourceConflict(value: unknown): value is ResourceConflictVersion {
    const conflict = value as Partial<ResourceConflictVersion>
    if (!conflict || !this.isConflictId(conflict.id) || !this.isTimestamp(conflict.detectedAt)) return false
    if (typeof conflict.resourceId !== 'string' || conflict.resourceId.length > 300) return false
    if (typeof conflict.source !== 'string' || !RESOURCE_SOURCES.has(conflict.source as ResourceSource)) return false
    if (typeof conflict.type !== 'string' || !RESOURCE_TYPES.has(conflict.type as ResourceType)) return false
    if (conflict.reason !== 'same_revision_diverged' && conflict.reason !== 'source_revision_regressed') return false
    if (typeof conflict.currentFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(conflict.currentFingerprint)) return false
    if (typeof conflict.incomingFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(conflict.incomingFingerprint)) return false
    if (!this.isResource(conflict.current) || !this.isResource(conflict.incoming)) return false
    if ([conflict.current, conflict.incoming].some((resource) => resource.id !== conflict.resourceId || resource.source !== conflict.source || resource.type !== conflict.type)) return false
    if (conflict.status === 'unresolved') return conflict.resolution === undefined && conflict.resolvedAt === undefined
    return conflict.status === 'resolved' && (conflict.resolution === 'keep_current' || conflict.resolution === 'accept_incoming') && this.isTimestamp(conflict.resolvedAt)
  }

  private contextOf(resource: Resource): ResourceContext {
    if (this.isContext(resource.context)) return structuredClone(resource.context)
    const metadata = resource.metadata
    const projects: string[] = []
    let time: ResourceContext['time']
    if (resource.type === 'task') {
      if (typeof metadata.category === 'string' && metadata.category) projects.push(metadata.category)
      if (typeof metadata.date === 'string') time = { startDate: metadata.date, endDate: metadata.date }
    } else if (resource.type === 'rss_item') {
      if (typeof metadata.feedTitle === 'string' && metadata.feedTitle) projects.push(metadata.feedTitle)
      time = { startAt: this.optionalTimestamp(metadata.publishedAt) || resource.createdAt, endAt: resource.updatedAt }
    } else if (resource.type === 'trip') {
      projects.push(resource.title)
      time = {
        startDate: typeof metadata.startDate === 'string' ? metadata.startDate : undefined,
        endDate: typeof metadata.endDate === 'string' ? metadata.endDate : undefined,
        timezone: typeof metadata.timezone === 'string' ? metadata.timezone : undefined
      }
    } else {
      time = { startAt: resource.createdAt, endAt: resource.updatedAt }
    }
    return { projects, time, locations: [] }
  }

  private isContext(value: unknown): value is ResourceContext {
    const context = value as Partial<ResourceContext>
    if (!context || !Array.isArray(context.projects) || context.projects.length > 20) return false
    if (!context.projects.every((project) => typeof project === 'string' && project.length > 0 && project.length <= 120 && !/\p{Cc}/u.test(project))) return false
    if (new Set(context.projects.map((project) => project.toLocaleLowerCase('zh-CN'))).size !== context.projects.length) return false
    if (!Array.isArray(context.locations) || context.locations.length > 100 || !context.locations.every((location) => this.isLocationContext(location))) return false
    if (context.time !== undefined) {
      const time = context.time
      if (!time || typeof time !== 'object' || Array.isArray(time)) return false
      if ([time.startAt, time.endAt, time.startDate, time.endDate].every((item) => item === undefined)) return false
      if (time.startAt !== undefined && !this.isTimestamp(time.startAt)) return false
      if (time.endAt !== undefined && !this.isTimestamp(time.endAt)) return false
      if (time.startAt !== undefined && time.endAt !== undefined && time.endAt < time.startAt) return false
      if (time.startDate !== undefined && !this.isCalendarDate(time.startDate)) return false
      if (time.endDate !== undefined && !this.isCalendarDate(time.endDate)) return false
      if (time.startDate && time.endDate && time.endDate < time.startDate) return false
      if (time.timezone !== undefined && !this.isTimezone(time.timezone)) return false
    }
    return true
  }

  private isLocationContext(value: unknown): value is ResourceLocationContext {
    const location = value as Partial<ResourceLocationContext>
    if (!location || typeof location.name !== 'string' || !location.name.trim() || location.name.length > 300) return false
    if (location.address !== undefined && (typeof location.address !== 'string' || location.address.length > 500)) return false
    const hasLatitude = location.latitude !== undefined
    const hasLongitude = location.longitude !== undefined
    if (hasLatitude !== hasLongitude) return false
    if (hasLatitude && (!Number.isFinite(location.latitude) || location.latitude! < -90 || location.latitude! > 90 || !Number.isFinite(location.longitude) || location.longitude! < -180 || location.longitude! > 180)) return false
    return true
  }

  private assertResourceId(id: string) {
    const value = typeof id === 'string' ? id.trim() : ''
    if (!/^[a-z0-9_-]+:[a-z0-9_-]+:.{1,200}$/i.test(value)) throw new BadRequestException('Invalid resource id')
    return value
  }

  private assertSyncMode(value: string) {
    if (value !== 'auto' && value !== 'full' && value !== 'incremental') throw new BadRequestException('Invalid Resource sync mode')
    return value as 'auto' | ResourceSyncMode
  }

  private assertConflictStatus(value: string) {
    if (value !== 'all' && value !== 'unresolved' && value !== 'resolved') throw new BadRequestException('Invalid Resource conflict status')
    return value as 'all' | ResourceConflictVersion['status']
  }

  private assertConflictId(value: string) {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!this.isConflictId(id)) throw new BadRequestException('Invalid Resource conflict id')
    return id
  }

  private isConflictId(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  }

  private assertConflictResolution(value: string) {
    if (value !== 'keep_current' && value !== 'accept_incoming') throw new BadRequestException('Invalid Resource conflict resolution')
    return value as ResourceConflictResolution
  }

  private assertType(value: string) {
    if (!RESOURCE_TYPES.has(value as ResourceType)) throw new BadRequestException('Invalid resource type')
    return value as ResourceType
  }

  private assertSource(value: string) {
    if (!RESOURCE_SOURCES.has(value as ResourceSource)) throw new BadRequestException('Invalid resource source')
    return value as ResourceSource
  }

  private assertPrivacy(value: string) {
    if (!PRIVACY_LEVELS.has(value as ResourcePrivacy)) throw new BadRequestException('Invalid privacy level')
    return value as ResourcePrivacy
  }

  private normalizeOffset(value?: number) {
    if (value === undefined) return 0
    if (!Number.isFinite(value)) throw new BadRequestException('Offset must be a number')
    return Math.max(0, Math.trunc(value))
  }

  private normalizeLimit(value: number | undefined, fallback: number) {
    if (value === undefined) return fallback
    if (!Number.isFinite(value)) throw new BadRequestException('Limit must be a number')
    return Math.max(1, Math.min(200, Math.trunc(value)))
  }

  private cleanQuery(value: string) {
    const query = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
    if (!query) throw new BadRequestException('Search query is required')
    if (query.length > 200) throw new BadRequestException('Search query is too long')
    return query
  }

  private compact(value: string) {
    return value.replace(/\s+/g, ' ').trim()
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 240) : 'Unknown sync error'
  }

  private normalizeOptionalBoolean(value: string | undefined, label: string) {
    if (value === undefined || value === '') return undefined
    if (value === 'true') return true
    if (value === 'false') return false
    throw new BadRequestException(`${label} must be true or false`)
  }

  private cleanOptionalFilter(value: string | undefined, label: string) {
    if (value === undefined) return undefined
    const normalized = value.trim().replace(/\s+/g, ' ')
    if (!normalized) return undefined
    if (normalized.length > 120 || /\p{Cc}/u.test(normalized)) throw new BadRequestException(`${label} filter is invalid`)
    return normalized.toLocaleLowerCase('zh-CN')
  }

  private normalizeDateRange(fromDate?: string, toDate?: string) {
    const from = fromDate ? this.assertCalendarDate(fromDate, 'fromDate') : undefined
    const to = toDate ? this.assertCalendarDate(toDate, 'toDate') : undefined
    if (from && to && to < from) throw new BadRequestException('toDate cannot be before fromDate')
    return { from, to }
  }

  private matchesDateRange(resource: Resource, range: { from?: string; to?: string }) {
    if (!range.from && !range.to) return true
    const time = this.contextOf(resource).time
    if (!time) return false
    const start = time.startAt ?? (time.startDate ? Date.parse(`${time.startDate}T00:00:00.000Z`) : undefined)
    const end = time.endAt ?? (time.endDate ? Date.parse(`${time.endDate}T23:59:59.999Z`) : start)
    if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end)) return false
    const minimum = range.from ? Date.parse(`${range.from}T00:00:00.000Z`) : undefined
    const maximum = range.to ? Date.parse(`${range.to}T23:59:59.999Z`) : undefined
    return (minimum === undefined || end >= minimum) && (maximum === undefined || start <= maximum)
  }

  private assertCalendarDate(value: string, label: string) {
    const date = typeof value === 'string' ? value.trim() : ''
    if (!this.isCalendarDate(date)) throw new BadRequestException(`${label} must be a real YYYY-MM-DD date`)
    return date
  }

  private isCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }

  private isTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  }

  private isTimezone(value: unknown): value is string {
    if (typeof value !== 'string' || !value || value.length > 100) return false
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
      return true
    } catch {
      return false
    }
  }

  private optionalTimestamp(value: unknown) {
    return this.isTimestamp(value) ? value : undefined
  }
}

function privacyWeight(value: ResourcePrivacy) {
  return value === 'secret' ? 2 : value === 'private' ? 1 : 0
}

function readBoundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function readOptionalInterval(name: string, minimum: number, maximum: number) {
  const raw = process.env[name]
  if (!raw) return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}
