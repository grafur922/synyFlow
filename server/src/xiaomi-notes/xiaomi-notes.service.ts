import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import type {
  XiaomiConnectorMode,
  XiaomiNote,
  XiaomiNoteFolder,
  XiaomiNoteInput,
  XiaomiNotePage,
  XiaomiRawNoteEntry
} from './xiaomi-note.model'
import { XiaomiNoteHistoryService } from './xiaomi-note-history.service'
import { getXiaomiCloudCookie } from '../security/secrets'

const XIAOMI_BASE_URL = 'https://i.mi.com'
const LIST_CACHE_TTL_MS = 20_000
const DETAIL_CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 100
const REQUEST_TIMEOUT_MS = 12_000
const MAX_TITLE_LENGTH = 200
const MAX_CONTENT_LENGTH = 80_000
const MAX_UPSTREAM_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_COOKIE_LENGTH = 24_000
const CIRCUIT_FAILURE_THRESHOLD = readBoundedInteger('TERRA_XIAOMI_FAILURE_THRESHOLD', 3, 1, 10)
const CIRCUIT_COOLDOWN_MS = readBoundedInteger('TERRA_XIAOMI_CIRCUIT_COOLDOWN_MS', 30_000, 5_000, 10 * 60_000)
const MAX_AUDIT_EVENTS = 100

type CacheEntry<T> = { value: T; expiresAt: number }
type XiaomiEnvelope<T> = {
  result?: string
  code?: number
  description?: string
  retriable?: boolean
  data?: T
}

type XiaomiPageData = {
  entries?: XiaomiRawNoteEntry[]
  folders?: XiaomiRawNoteEntry[]
  syncTag?: string
  lastPage?: boolean
}

type XiaomiDetailData = { entry?: XiaomiRawNoteEntry }
type XiaomiMutationData = {
  id?: string
  tag?: string
  modifyDate?: number
  conflict?: boolean
  entry?: XiaomiRawNoteEntry
}

type XiaomiAuditEvent = {
  at: number
  operation: string
  outcome: 'success' | 'failure' | 'blocked'
  durationMs: number
  targetHash: string
  errorClass?: string
}

@Injectable()
export class XiaomiNotesService {
  private readonly cookie = getXiaomiCloudCookie()
  private readonly serviceToken = this.readCookieValue('serviceToken')
  private readonly listCache = new Map<string, CacheEntry<XiaomiNotePage>>()
  private readonly detailCache = new Map<string, CacheEntry<XiaomiNote>>()
  private readonly readOnly = process.env.TERRA_XIAOMI_READ_ONLY === 'true'
  private readonly auditToStdout = process.env.TERRA_XIAOMI_AUDIT_STDOUT === 'true'
  private readonly auditEvents: XiaomiAuditEvent[] = []
  private consecutiveFailures = 0
  private circuitOpenedUntil = 0
  private credentialsInvalid = false
  private lastSuccessAt?: number
  private lastFailureAt?: number
  private mutationQueue: Promise<unknown> = Promise.resolve()

  constructor(private readonly history: XiaomiNoteHistoryService) {}

  getStatus() {
    const configured = this.isConfigured()
    const circuitOpen = this.isCircuitOpen()
    let mode: XiaomiConnectorMode = 'ready'
    if (!configured) mode = 'unconfigured'
    else if (this.credentialsInvalid) mode = 'credentials_invalid'
    else if (circuitOpen) mode = 'circuit_open'
    else if (this.readOnly) mode = 'readonly'
    const retryAfterSeconds = circuitOpen
      ? Math.max(1, Math.ceil((this.circuitOpenedUntil - Date.now()) / 1000))
      : undefined
    let message = '小米云凭证已在服务端配置'
    if (!configured) message = '请在后端环境变量 XIAOMI_CLOUD_COOKIE 中配置完整 Cookie'
    else if (this.credentialsInvalid) message = '小米云登录凭证已失效，请更新服务端 Cookie 并重启 Terra Server'
    else if (circuitOpen) message = `小米云连续请求失败，连接器暂时熔断，请 ${retryAfterSeconds} 秒后重试`
    else if (this.readOnly) message = '小米笔记连接器处于只读安全模式'
    return {
      configured,
      writable: configured && !this.readOnly && !this.credentialsInvalid && !circuitOpen,
      mode,
      cacheTtlSeconds: LIST_CACHE_TTL_MS / 1000,
      retryAfterSeconds,
      consecutiveFailures: this.consecutiveFailures,
      audit: {
        retainedEvents: this.auditEvents.length,
        lastEventAt: this.auditEvents.at(-1)?.at,
        lastSuccessAt: this.lastSuccessAt,
        lastFailureAt: this.lastFailureAt
      },
      historyStorage: this.history.getStorageStatus(),
      message
    }
  }

  getAuditEvents() {
    return this.auditEvents.map(({ targetHash, ...event }) => ({ targetHash, ...event }))
  }

  async findPage(options: { cursor?: string; limit?: number; forceRefresh?: boolean } = {}) {
    this.assertConfigured()
    const cursor = this.cleanCursor(options.cursor)
    const limit = this.normalizeLimit(options.limit)
    const cacheKey = `${cursor || 'first'}:${limit}`

    if (!options.forceRefresh) {
      const cached = this.getCache(this.listCache, cacheKey)
      if (cached) return { ...cached, cached: true }
    }

    const query = new URLSearchParams({
      ts: String(Date.now()),
      limit: String(limit)
    })
    if (cursor) query.set('syncTag', cursor)

    const data = await this.request<XiaomiPageData>(`/note/full/page?${query.toString()}`)
    if (data.entries !== undefined && !Array.isArray(data.entries)) {
      throw new BadGatewayException('小米笔记列表响应中的 entries 格式不正确')
    }
    if (data.folders !== undefined && !Array.isArray(data.folders)) {
      throw new BadGatewayException('小米笔记列表响应中的 folders 格式不正确')
    }
    const syncCursor = this.cleanCursor(data.syncTag)
    const nextCursor = data.lastPage ? undefined : syncCursor
    if (!data.lastPage && !nextCursor) {
      throw new BadGatewayException('小米笔记分页响应缺少下一页游标')
    }
    const page: XiaomiNotePage = {
      notes: (data.entries || [])
        .filter((entry) => entry?.type !== 'folder' && entry?.status !== 'deleted')
        .map((entry) => this.toNote(entry, false)),
      folders: (data.folders || []).map((folder) => this.toFolder(folder)),
      syncCursor,
      nextCursor,
      lastPage: Boolean(data.lastPage),
      cached: false
    }

    this.setCache(this.listCache, cacheKey, page, LIST_CACHE_TTL_MS)
    return page
  }

  async findOne(id: string, forceRefresh = false) {
    this.assertConfigured()
    const safeId = this.assertId(id)

    if (!forceRefresh) {
      const cached = this.getCache(this.detailCache, safeId)
      if (cached) return cached
    }

    const data = await this.request<XiaomiDetailData>(
      `/note/note/${safeId}/?ts=${Date.now()}`
    )
    if (!data.entry) throw new BadGatewayException('小米笔记详情响应缺少 entry')

    const note = this.toNote(data.entry, true)
    this.setCache(this.detailCache, safeId, note, DETAIL_CACHE_TTL_MS)
    return note
  }

  create(input: XiaomiNoteInput) {
    return this.enqueueMutation(async () => {
      this.assertWritable()
      await this.history.ensureAvailable()
      const noteInput = this.normalizeInput(input)
      const now = Date.now()
      const created = await this.postForm<XiaomiMutationData>('/note/note', {
        entry: JSON.stringify({
          content: '',
          colorId: 0,
          folderId: '0',
          createDate: now,
          modifyDate: now
        })
      })

      const baseEntry = created.entry
      if (!baseEntry?.id) throw new BadGatewayException('Xiaomi create response is missing entry')

      await this.saveExisting(baseEntry, noteInput)
      this.invalidateCaches(baseEntry.id)
      const note = await this.findOne(baseEntry.id, true)
      await this.history.capture(note, 'created')
      return note
    })
  }

  update(id: string, input: XiaomiNoteInput) {
    return this.enqueueMutation(async () => {
      this.assertWritable()
      await this.history.ensureAvailable()
      const safeId = this.assertId(id)
      const noteInput = this.normalizeInput(input)
      const detail = await this.request<XiaomiDetailData>(
        `/note/note/${safeId}/?ts=${Date.now()}`
      )
      if (!detail.entry) throw new BadGatewayException('Xiaomi note detail response is missing entry')

      const current = this.toNote(detail.entry, true)
      if (current.title !== noteInput.title || current.content !== noteInput.content) {
        await this.history.capture(current, 'before_update')
      }
      await this.saveExisting(detail.entry, noteInput)
      this.invalidateCaches(safeId)
      return this.findOne(safeId, true)
    })
  }

  remove(id: string) {
    return this.enqueueMutation(async () => {
      this.assertWritable()
      await this.history.ensureAvailable()
      const safeId = this.assertId(id)
      const detail = await this.request<XiaomiDetailData>(
        `/note/note/${safeId}/?ts=${Date.now()}`
      )
      if (!detail.entry?.tag) throw new BadGatewayException('Xiaomi note detail response is missing tag')

      await this.history.capture(this.toNote(detail.entry, true), 'before_delete')
      const result = await this.postForm<XiaomiMutationData>(
        `/note/full/${safeId}/delete`,
        { tag: detail.entry.tag, purge: 'false' }
      )
      if (result.conflict) throw new BadGatewayException('Delete conflict; refresh and try again')

      this.invalidateCaches(safeId)
      return { id: safeId, deleted: true }
    })
  }

  async findHistoryArchive() {
    return this.history.findArchive()
  }

  async recreateFromHistory(historyId: string) {
    this.assertConfigured()
    const historical = await this.history.findByHistoryId(historyId)
    return this.create({ title: historical.title, content: historical.content })
  }

  async findHistory(id: string) {
    const safeId = this.assertId(id)
    return this.history.findAll(safeId)
  }

  async findHistoryVersion(id: string, historyId: string) {
    const safeId = this.assertId(id)
    return this.history.findOne(safeId, historyId)
  }

  async removeHistoryVersion(id: string, historyId: string) {
    const safeId = this.assertId(id)
    return this.history.removeOne(safeId, historyId)
  }

  async clearHistory(id: string) {
    const safeId = this.assertId(id)
    return this.history.removeAll(safeId)
  }

  async createHistoryCheckpoint(id: string) {
    this.assertConfigured()
    await this.history.ensureAvailable()
    const note = await this.findOne(this.assertId(id), true)
    return this.history.capture(note, 'manual')
  }

  restoreHistory(id: string, historyId: string) {
    return this.enqueueMutation(async () => {
      this.assertWritable()
      const safeId = this.assertId(id)
      const historical = await this.history.findOne(safeId, historyId)
      const detail = await this.request<XiaomiDetailData>(
        `/note/note/${safeId}/?ts=${Date.now()}`
      )
      if (!detail.entry) throw new BadGatewayException('Xiaomi note detail response is missing entry')

      const current = this.toNote(detail.entry, true)
      await this.history.capture(current, 'before_restore')
      await this.saveExisting(detail.entry, {
        title: historical.title,
        content: historical.content
      })
      this.invalidateCaches(safeId)
      const restored = await this.findOne(safeId, true)
      await this.history.capture(restored, 'restored')
      return restored
    })
  }

  private async saveExisting(entry: XiaomiRawNoteEntry, input: XiaomiNoteInput) {
    const extraInfo = this.mergeExtraInfo(entry.extraInfo, input.title)
    const payload: XiaomiRawNoteEntry = {
      ...entry,
      id: this.assertId(entry.id),
      tag: String(entry.tag || entry.id),
      status: entry.status || 'normal',
      createDate: Number(entry.createDate || Date.now()),
      modifyDate: Date.now(),
      colorId: Number(entry.colorId || 0),
      folderId: String(entry.folderId ?? '0'),
      alertDate: Number(entry.alertDate || 0),
      content: this.toPlainText(entry.content || '') === input.content
        ? (entry.content || '')
        : this.toXiaomiContent(input.content),
      extraInfo
    }

    delete payload.snippet
    delete payload.subject
    delete payload.type

    const result = await this.postForm<XiaomiMutationData>(`/note/note/${payload.id}`, {
      entry: JSON.stringify(payload)
    })
    if (result.conflict) throw new BadGatewayException('保存发生版本冲突，请刷新后重试')
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    this.assertUpstreamAvailable(path)
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`${XIAOMI_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Cookie: this.cookie,
          Origin: XIAOMI_BASE_URL,
          Referer: `${XIAOMI_BASE_URL}/note/h5`,
          'User-Agent': 'TerraHub/0.2 (personal Xiaomi Notes connector)',
          ...init?.headers
        }
      })

      const contentLength = Number(response.headers.get('content-length') || 0)
      if (contentLength > MAX_UPSTREAM_RESPONSE_BYTES) {
        throw new BadGatewayException('Xiaomi response exceeded the allowed size')
      }
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_UPSTREAM_RESPONSE_BYTES) {
        throw new BadGatewayException('Xiaomi response exceeded the allowed size')
      }
      let envelope: XiaomiEnvelope<T>
      try {
        envelope = JSON.parse(text) as XiaomiEnvelope<T>
      } catch {
        throw new BadGatewayException(`小米云返回了无法解析的响应（HTTP ${response.status}）`)
      }

      if (!response.ok || envelope.result !== 'ok' || envelope.code !== 0 || !envelope.data) {
        const description = this.safeUpstreamMessage(envelope.description)
        const errorMessage = description || `小米云请求失败（HTTP ${response.status}）`
        if (response.status === 401 || response.status === 403) {
          this.credentialsInvalid = true
          throw new ServiceUnavailableException('小米云登录凭证已失效，请更新服务端 Cookie')
        }
        throw new BadGatewayException(errorMessage)
      }

      this.recordSuccess(path, startedAt)
      return envelope.data
    } catch (error) {
      if (error instanceof HttpException) {
        this.recordFailure(path, startedAt, error)
        throw error
      }
      if ((error as { name?: string }).name === 'AbortError') {
        const timeout = new GatewayTimeoutException('连接小米云超时，请稍后重试')
        this.recordFailure(path, startedAt, timeout)
        throw timeout
      }
      const unavailable = new BadGatewayException('无法连接小米云，请检查网络或稍后重试')
      this.recordFailure(path, startedAt, unavailable)
      throw unavailable
    } finally {
      clearTimeout(timer)
    }
  }

  private postForm<T>(path: string, values: Record<string, string>) {
    const form = new URLSearchParams({ ...values, serviceToken: this.serviceToken })
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: form.toString()
    })
  }

  private toNote(entry: XiaomiRawNoteEntry, includeContent: boolean): XiaomiNote {
    const content = this.toPlainText(entry.content || entry.snippet || '')
    const title = this.readTitle(entry.extraInfo) || this.firstMeaningfulLine(content) || '无标题笔记'
    const note: XiaomiNote = {
      id: this.assertId(String(entry.id)),
      tag: String(entry.tag || entry.id),
      title: title.slice(0, MAX_TITLE_LENGTH),
      preview: this.compactText(content).slice(0, 180),
      createDate: Number(entry.createDate || 0),
      modifyDate: Number(entry.modifyDate || 0),
      colorId: Number(entry.colorId || 0),
      folderId: String(entry.folderId ?? '0'),
      status: String(entry.status || 'normal'),
      hasRichFormatting: this.hasRichFormatting(entry)
    }
    if (includeContent) note.content = content
    return note
  }

  private toFolder(entry: XiaomiRawNoteEntry): XiaomiNoteFolder {
    return {
      id: this.assertFolderId(entry.id),
      title: String(entry.subject || this.readTitle(entry.extraInfo) || 'Untitled folder').trim(),
      createDate: Number(entry.createDate || 0),
      modifyDate: Number(entry.modifyDate || 0)
    }
  }

  private normalizeInput(input: XiaomiNoteInput): XiaomiNoteInput {
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    const content = typeof input?.content === 'string' ? input.content.replace(/\r\n/g, '\n') : ''

    if (!title && !content.trim()) throw new BadRequestException('标题和正文不能同时为空')
    if (title.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(`标题不能超过 ${MAX_TITLE_LENGTH} 个字符`)
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(`正文不能超过 ${MAX_CONTENT_LENGTH} 个字符`)
    }

    return { title, content }
  }

  private toXiaomiContent(content: string) {
    const lines = content.split('\n')
    return lines
      .map((line) => `<text indent="1">${this.escapeXml(line)}</text>`)
      .join('\n')
  }

  private toPlainText(content: string) {
    if (!content) return ''
    const withBreaks = content
      .replace(/<\/text>\s*/gi, '\n')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
    return this.decodeEntities(withBreaks).replace(/\n{3,}/g, '\n\n').trimEnd()
  }

  private hasRichFormatting(entry: XiaomiRawNoteEntry) {
    const content = entry.content || entry.snippet || ''
    if (/<(?!\/?text\b)[^>]+>/i.test(content)) return true
    if (/\b(style|font|size|bold|italic|underline|checked|list|image)=/i.test(content)) return true

    if (entry.extraInfo) {
      try {
        const extra = JSON.parse(entry.extraInfo) as Record<string, unknown>
        if (typeof extra.note_content_type === 'string' && extra.note_content_type !== 'common') return true
        for (const key of ['web_images', 'mind_content', 'mind_content_plain_text']) {
          if (typeof extra[key] === 'string' && extra[key]) return true
        }
      } catch {
        return true
      }
    }
    return false
  }

  private readTitle(extraInfo?: string) {
    if (!extraInfo) return ''
    try {
      const parsed = JSON.parse(extraInfo) as { title?: unknown }
      return typeof parsed.title === 'string' ? parsed.title.trim() : ''
    } catch {
      return ''
    }
  }

  private mergeExtraInfo(extraInfo: string | undefined, title: string) {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = extraInfo ? JSON.parse(extraInfo) as Record<string, unknown> : {}
    } catch {
      parsed = {}
    }
    return JSON.stringify({
      note_content_type: 'common',
      web_images: '',
      mind_content_plain_text: '',
      mind_content: '',
      ...parsed,
      title
    })
  }

  private readCookieValue(name: string) {
    const pair = this.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))
    return pair ? pair.slice(name.length + 1) : ''
  }

  private isConfigured() {
    return Boolean(
      this.cookie &&
      this.cookie.length <= MAX_COOKIE_LENGTH &&
      this.serviceToken &&
      !/[\r\n]/.test(this.cookie)
    )
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('小米笔记连接器未配置，请在后端设置 XIAOMI_CLOUD_COOKIE')
    }
  }

  private assertWritable() {
    this.assertConfigured()
    if (this.readOnly) throw new ServiceUnavailableException('小米笔记连接器处于只读安全模式，未执行写操作')
    this.assertUpstreamAvailable('mutation')
  }

  private assertUpstreamAvailable(operation: string) {
    if (this.credentialsInvalid) {
      this.recordAudit(operation, 'blocked', 0, new ServiceUnavailableException('credentials invalid'))
      throw new ServiceUnavailableException('小米云登录凭证已失效，请更新服务端 Cookie 并重启 Terra Server')
    }
    if (!this.isCircuitOpen()) return
    const retryAfter = Math.max(1, Math.ceil((this.circuitOpenedUntil - Date.now()) / 1000))
    this.recordAudit(operation, 'blocked', 0, new ServiceUnavailableException('circuit open'))
    throw new ServiceUnavailableException(`小米云连接器暂时熔断，请 ${retryAfter} 秒后重试`)
  }

  private isCircuitOpen() {
    return this.circuitOpenedUntil > Date.now()
  }

  private recordSuccess(operation: string, startedAt: number) {
    this.consecutiveFailures = 0
    this.circuitOpenedUntil = 0
    this.credentialsInvalid = false
    this.lastSuccessAt = Date.now()
    this.recordAudit(operation, 'success', Date.now() - startedAt)
  }

  private recordFailure(operation: string, startedAt: number, error: unknown) {
    this.consecutiveFailures += 1
    this.lastFailureAt = Date.now()
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitOpenedUntil = Date.now() + CIRCUIT_COOLDOWN_MS
    }
    this.recordAudit(operation, 'failure', Date.now() - startedAt, error)
  }

  private recordAudit(operation: string, outcome: XiaomiAuditEvent['outcome'], durationMs: number, error?: unknown) {
    const event: XiaomiAuditEvent = {
      at: Date.now(),
      operation: this.classifyOperation(operation),
      outcome,
      durationMs: Math.max(0, Math.min(durationMs, 120_000)),
      targetHash: this.hashTarget(operation),
      errorClass: error instanceof Error ? error.constructor.name.slice(0, 80) : undefined
    }
    this.auditEvents.push(event)
    if (this.auditEvents.length > MAX_AUDIT_EVENTS) this.auditEvents.splice(0, this.auditEvents.length - MAX_AUDIT_EVENTS)
    if (this.auditToStdout) {
      const { targetHash, ...redacted } = event
      console.info('[xiaomi-audit]', JSON.stringify({ ...redacted, targetHash }))
    }
  }

  private hashTarget(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
  }

  private classifyOperation(value: string) {
    if (value === 'mutation') return 'mutation_guard'
    if (value.startsWith('/note/full/page')) return 'list_notes'
    if (/^\/note\/full\/\d+\/delete$/.test(value)) return 'delete_note'
    if (value === '/note/note') return 'create_note'
    if (/^\/note\/note\/\d+\/$/.test(value.split('?')[0])) return 'read_note'
    if (/^\/note\/note\/\d+$/.test(value)) return 'update_note'
    return 'upstream_request'
  }

  private assertId(id: unknown) {
    const value = typeof id === 'string' ? id.trim() : ''
    if (!/^\d{8,32}$/.test(value)) throw new BadRequestException('笔记 ID 格式不正确')
    return value
  }

  private cleanCursor(cursor?: string) {
    const value = typeof cursor === 'string' ? cursor.trim() : ''
    if (!value) return undefined
    if (!/^\d{8,32}$/.test(value)) throw new BadRequestException('分页游标格式不正确')
    return value
  }

  private normalizeLimit(limit?: number) {
    if (limit === undefined) return 100
    if (!Number.isFinite(limit)) throw new BadRequestException('limit 必须是数字')
    return Math.max(1, Math.min(200, Math.trunc(limit)))
  }

  private compactText(value: string) {
    return value.replace(/\s+/g, ' ').trim()
  }

  private firstMeaningfulLine(value: string) {
    return value.split('\n').map((line) => line.trim()).find(Boolean) || ''
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  private decodeEntities(value: string) {
    return value
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
  }

  private safeUpstreamMessage(message?: string) {
    if (!message) return ''
    const safe = message.replace(/[\r\n]/g, ' ').trim()
    return safe.length <= 160 ? safe : safe.slice(0, 160)
  }

  private getCache<T>(cache: Map<string, CacheEntry<T>>, key: string) {
    const item = cache.get(key)
    if (!item) return undefined
    if (item.expiresAt <= Date.now()) {
      cache.delete(key)
      return undefined
    }
    return item.value
  }

  private setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number) {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value as string | undefined
      if (oldestKey) cache.delete(oldestKey)
    }
    cache.set(key, { value, expiresAt: Date.now() + ttl })
  }

  private invalidateCaches(id?: string) {
    this.listCache.clear()
    if (id) this.detailCache.delete(id)
  }

  private enqueueMutation<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work)
    this.mutationQueue = next.catch(() => undefined)
    return next
  }

  private assertFolderId(id: unknown) {
    const value = typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''
    if (!/^(?:0|\d{8,32})$/.test(value)) throw new BadGatewayException('小米笔记文件夹 ID 格式不正确')
    return value
  }
}

function readBoundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}
