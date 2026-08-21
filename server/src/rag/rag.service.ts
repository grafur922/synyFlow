import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BlogPrivacyScanner } from '../blog/blog-privacy-scanner'
import type { Resource } from '../resources/resource.model'
import type { XiaomiNote } from '../xiaomi-notes/xiaomi-note.model'
import { ResourcesService } from '../resources/resources.service'
import { EncryptedJsonStore } from '../storage/encrypted-json.store'
import {
  getAliyunEmbeddingCredentialStatus,
  getDataEncryptionSecret,
  removeAliyunEmbeddingApiKey,
  setAliyunEmbeddingApiKey
} from '../security/secrets'
import { cosineSimilarity, LocalHashEmbeddingProvider, termFrequency, tokenizeText } from './local-embedding.provider'
import { PromptInjectionScanner } from './prompt-injection-scanner'
import { digest, RagIndexer } from './rag-indexer'
import { ExternalRagProvider } from './external-rag.provider'
import { AliyunEmbeddingProvider } from './aliyun-embedding.provider'
import { LanceDbVectorStore } from './lancedb-vector.store'
import { DEFAULT_RAG_EMBEDDING_SETTINGS } from './rag.model'
import type {
  CreateRagDocumentInput,
  RagChunk,
  RagCitation,
  RagConfidence,
  RagDocument,
  RagDocumentSummary,
  RagInjectionFinding,
  RagEmbeddingSettings,
  RagMimeType,
  RagPrivacy,
  RagQueryProvider,
  RagQueryInput,
  RagQueryResult,
  RagSensitiveFinding,
  RagState,
  RagSyncLedgerEntry,
  LegacyRagState,
  UpdateRagDocumentInput
} from './rag.model'

const MAX_DOCUMENTS = 2_000
const MAX_CHUNKS = 50_000
const MAX_CONTENT_CHARS = 150_000
const MAX_CONTENT_BYTES = 460_000
const MAX_QUERY_CACHE = 100
const PRIVACY = new Set<RagPrivacy>(['public', 'private', 'secret'])
const MIME_TYPES = new Set<RagMimeType>(['text/plain', 'text/markdown', 'application/json', 'text/csv'])
const PRIVACY_WEIGHT: Record<RagPrivacy, number> = { public: 0, private: 1, secret: 2 }

type Candidate = {
  chunk: RagChunk
  document: RagDocument
  keywordRaw: number
  vectorScore: number
  titleBoost: number
  score: number
}

@Injectable()
export class RagService {
  private readonly store: EncryptedJsonStore<RagState | LegacyRagState>
  private readonly embeddingProvider = new LocalHashEmbeddingProvider()
  private readonly injectionScanner = new PromptInjectionScanner()
  private readonly indexer = new RagIndexer(this.embeddingProvider, this.injectionScanner)
  private readonly privacyScanner = new BlogPrivacyScanner()
  private readonly queryCache = new Map<string, RagQueryResult>()
  private stateCache?: RagState
  private resourceSyncError = ''
  private denseQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly externalProvider: ExternalRagProvider,
    private readonly aliyunEmbeddingProvider: AliyunEmbeddingProvider,
    private readonly vectorStore: LanceDbVectorStore
  ) {
    const encryptionSecret = getDataEncryptionSecret()
    this.store = new EncryptedJsonStore<RagState | LegacyRagState>({
      filePath: process.env.TERRA_RAG_FILE || join(process.cwd(), 'data', 'rag.json'),
      encryptionSecret,
      encryptedFormat: 'terra-rag-state',
      defaultValue: () => this.createDefaultState(),
      validate: (value): value is RagState | LegacyRagState => this.isPersistedState(value),
      maxPlaintextBytes: 256 * 1024 * 1024
    })
    void this.store.initialize()
  }

  async getStatus() {
    const state = await this.readState()
    const uniqueChunks = new Set(state.chunks.map((chunk) => chunk.contentHash)).size
    const embeddingSettings = this.resolveEmbeddingSettings(state.embeddingSettings)
    const vectorStore = await this.vectorStore.getStatus()
    return {
      ...this.store.getStatus(),
      documentCount: state.documents.length,
      chunkCount: state.chunks.length,
      uniqueChunkCount: uniqueChunks,
      flaggedChunkCount: state.chunks.filter((chunk) => chunk.injectionRisk === 'high').length,
      sensitiveFindingCount: state.documents.reduce((sum, document) => sum + document.sensitiveFindings.length, 0),
      maxDocuments: MAX_DOCUMENTS,
      maxDocumentCharacters: MAX_CONTENT_CHARS,
      revision: state.revision,
      embeddingProvider: this.embeddingProvider.id,
      embeddingLocal: this.embeddingProvider.local,
      externalRequests: false,
      externalProvider: this.externalProvider.getStatus(),
      denseEmbedding: this.aliyunEmbeddingProvider.getStatus(embeddingSettings),
      vectorStore,
      vectorCoverage: {
        ready: state.documents.filter((document) => document.vectorState === 'ready').length,
        pending: state.documents.filter((document) => document.vectorState === 'pending').length,
        failed: state.documents.filter((document) => document.vectorState === 'failed').length,
        localOnly: state.documents.filter((document) => document.vectorState === 'local-only' || document.privacy === 'secret').length
      },
      resourceSyncError: this.resourceSyncError || undefined
    }
  }

  async getSettings() {
    const state = await this.readState()
    const settings = this.resolveEmbeddingSettings(state.embeddingSettings)
    return {
      settings,
      storedSettings: structuredClone(state.embeddingSettings),
      environmentOverrides: this.embeddingEnvironmentOverrides(),
      credential: getAliyunEmbeddingCredentialStatus(),
      embeddingVersion: this.aliyunEmbeddingProvider.getVersion(settings)
    }
  }

  async updateSettings(input: Partial<RagEmbeddingSettings>) {
    let updated!: RagEmbeddingSettings
    await this.mutate((state) => {
      const current = state.embeddingSettings
      const next: RagEmbeddingSettings = {
        ...current,
        enabled: input.enabled === undefined ? current.enabled : this.normalizeBoolean(input.enabled, 'enabled'),
        baseUrl: input.baseUrl === undefined ? current.baseUrl : this.normalizeEmbeddingBaseUrl(input.baseUrl),
        model: input.model === undefined ? current.model : this.normalizeEmbeddingModel(input.model),
        dimensions: input.dimensions === undefined ? current.dimensions : this.normalizeEmbeddingDimensions(input.dimensions),
        batchSize: input.batchSize === undefined ? current.batchSize : this.normalizeInteger(input.batchSize, 'batchSize', 1, 10),
        timeoutMs: input.timeoutMs === undefined ? current.timeoutMs : this.normalizeInteger(input.timeoutMs, 'timeoutMs', 1_000, 120_000),
        autoSyncXiaomi: input.autoSyncXiaomi === undefined ? current.autoSyncXiaomi : this.normalizeBoolean(input.autoSyncXiaomi, 'autoSyncXiaomi'),
        xiaomiDefaultPrivacy: input.xiaomiDefaultPrivacy === undefined ? (current.xiaomiDefaultPrivacy || 'private') : this.normalizePrivacy(input.xiaomiDefaultPrivacy),
        autoRetry: input.autoRetry === undefined ? current.autoRetry : this.normalizeBoolean(input.autoRetry, 'autoRetry'),
        dailyTokenBudget: input.dailyTokenBudget === undefined ? current.dailyTokenBudget : this.normalizeOptionalBudget(input.dailyTokenBudget)
      }
      const oldVersion = this.aliyunEmbeddingProvider.getVersion(this.resolveEmbeddingSettings(current))
      const newVersion = this.aliyunEmbeddingProvider.getVersion(this.resolveEmbeddingSettings(next))
      if (oldVersion !== newVersion) next.pendingVectorVersion = newVersion
      updated = next
      state.embeddingSettings = next
    })
    return this.getSettings()
  }

  saveEmbeddingCredential(apiKey: unknown) {
    try { return setAliyunEmbeddingApiKey(typeof apiKey === 'string' ? apiKey : '') }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Aliyun API Key is invalid') }
  }

  removeEmbeddingCredential() {
    try { return removeAliyunEmbeddingApiKey() }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Aliyun API Key could not be removed') }
  }

  async testEmbeddingConnection() {
    const state = await this.readState()
    return this.aliyunEmbeddingProvider.testConnection(this.resolveEmbeddingSettings({ ...state.embeddingSettings, enabled: true }))
  }

  async findAll() {
    const state = await this.readState()
    return state.documents.map((document) => this.toSummary(document)).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async findOne(id: string) {
    const state = await this.readState()
    return structuredClone(this.requireDocument(state, id))
  }

  async create(input: CreateRagDocumentInput) {
    const source = input.source === undefined ? 'manual' : input.source
    if (source !== 'manual' && source !== 'file') throw new BadRequestException('Invalid document source')
    return this.createDocument({ ...input, source })
  }

  async createFromResource(resourceId: string) {
    const resource = await this.resourcesService.findOne(resourceId)
    if (resource.type === 'document' && resource.source === 'upload') {
      throw new BadRequestException('A RAG document cannot import itself from the Resource index')
    }
    const content = resource.content || resource.summary
    return this.createDocument({
      title: resource.title,
      content,
      tags: resource.tags,
      privacy: resource.privacy,
      mimeType: 'text/plain',
      source: 'resource'
    }, resource.id)
  }

  async update(id: string, input: UpdateRagDocumentInput) {
    const safeId = this.assertUuid(id)
    let updated!: RagDocument
    let densePreviousChunks: RagChunk[] = []
    let denseNextChunks: RagChunk[] = []
    await this.mutate((state) => {
      const index = state.documents.findIndex((document) => document.id === safeId)
      if (index < 0) throw new NotFoundException('RAG document was not found')
      const current = state.documents[index]
      if (current.sourceManaged && (
        input.title !== undefined || input.content !== undefined || input.mimeType !== undefined || input.originalFilename !== undefined
      )) throw new ConflictException('Source-managed document content is read-only')
      const title = input.title === undefined ? current.title : this.normalizeTitle(input.title)
      const content = input.content === undefined ? current.content : this.normalizeContent(input.content)
      const contentHash = digest(content)
      if (state.documents.some((document) => document.id !== safeId && document.contentHash === contentHash)) {
        throw new ConflictException('An identical document already exists')
      }
      const contentChanged = contentHash !== current.contentHash
      const now = Date.now()
      const previousChunks = state.chunks.filter((chunk) => chunk.documentId === safeId)
      const nextChunks = contentChanged ? this.indexer.index(safeId, content, previousChunks) : previousChunks
      densePreviousChunks = previousChunks
      denseNextChunks = nextChunks
      updated = {
        ...current,
        title,
        content,
        contentHash,
        summary: this.createSummary(content),
        tags: input.tags === undefined ? current.tags : (
          current.sourceManaged
            ? this.mergeSourceAndUserTags(current, this.normalizeTags(input.tags))
            : this.normalizeTags(input.tags)
        ),
        userTags: current.sourceManaged && input.tags !== undefined ? this.normalizeTags(input.tags) : current.userTags,
        privacy: input.privacy === undefined ? current.privacy : this.normalizePrivacy(input.privacy),
        mimeType: input.mimeType === undefined ? current.mimeType : this.normalizeMimeType(input.mimeType),
        originalFilename: input.originalFilename === undefined ? current.originalFilename : this.normalizeOptionalFilename(input.originalFilename),
        sensitiveFindings: contentChanged ? this.scanSensitive(content) : current.sensitiveFindings,
        injectionFindings: contentChanged ? this.injectionScanner.scan(content) : current.injectionFindings,
        chunkCount: nextChunks.length,
        updatedAt: now,
        indexedAt: contentChanged ? now : current.indexedAt
      }
      state.documents[index] = updated
      if (contentChanged) state.chunks = [...state.chunks.filter((chunk) => chunk.documentId !== safeId), ...nextChunks]
      this.assertStateLimits(state)
    })
    await this.syncResourceIndex()
    this.queueDenseRefresh(updated.id, densePreviousChunks, denseNextChunks)
    return structuredClone(updated)
  }

  async remove(id: string) {
    const safeId = this.assertUuid(id)
    await this.mutate((state) => {
      const document = state.documents.find((item) => item.id === safeId)
      if (!document) throw new NotFoundException('RAG document was not found')
      if (document.sourceManaged) throw new ConflictException('Source-managed documents must be removed from their source')
      state.documents = state.documents.filter((document) => document.id !== safeId)
      state.chunks = state.chunks.filter((chunk) => chunk.documentId !== safeId)
    })
    await this.deleteDenseDocuments([safeId])
    await this.syncResourceIndex()
    return { id: safeId, removed: true }
  }

  async reindexOne(id: string) {
    const safeId = this.assertUuid(id)
    let result!: RagDocument
    let densePreviousChunks: RagChunk[] = []
    let denseNextChunks: RagChunk[] = []
    await this.mutate((state) => {
      const document = this.requireDocument(state, safeId)
      const previous = state.chunks.filter((chunk) => chunk.documentId === safeId)
      const chunks = this.indexer.index(safeId, document.content, previous)
      densePreviousChunks = previous
      denseNextChunks = chunks
      const indexedAt = Date.now()
      result = { ...document, chunkCount: chunks.length, indexedAt }
      state.documents[state.documents.findIndex((item) => item.id === safeId)] = result
      state.chunks = [...state.chunks.filter((chunk) => chunk.documentId !== safeId), ...chunks]
      this.assertStateLimits(state)
    })
    await this.syncResourceIndex()
    this.queueDenseRefresh(result.id, densePreviousChunks, denseNextChunks)
    return structuredClone(result)
  }

  async reindexAll() {
    let chunkCount = 0
    await this.mutate(async (state) => {
      const previousByDocument = new Map<string, RagChunk[]>()
      for (const chunk of state.chunks) {
        const current = previousByDocument.get(chunk.documentId) || []
        current.push(chunk)
        previousByDocument.set(chunk.documentId, current)
      }
      const chunks: RagChunk[] = []
      const indexedAt = Date.now()
      for (let index = 0; index < state.documents.length; index += 1) {
        const document = state.documents[index]
        const next = this.indexer.index(document.id, document.content, previousByDocument.get(document.id) || [])
        chunks.push(...next)
        document.chunkCount = next.length
        document.indexedAt = indexedAt
        if (index > 0 && index % 20 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
      }
      state.chunks = chunks
      chunkCount = chunks.length
      this.assertStateLimits(state)
    })
    await this.syncResourceIndex()
    return { documents: (await this.readState()).documents.length, chunks: chunkCount, reindexedAt: Date.now() }
  }

  async getXiaomiSyncLedger() {
    const state = await this.readState()
    return structuredClone(state.syncLedger.filter((entry) => entry.source === 'xiaomi-note'))
  }

  async markXiaomiNoteSeen(note: Pick<XiaomiNote, 'id' | 'modifyDate' | 'tag'>, generation: string) {
    await this.mutate((state) => {
      const entry = state.syncLedger.find((item) => item.source === 'xiaomi-note' && item.sourceItemId === note.id)
      if (!entry) return
      entry.remoteModifyDate = note.modifyDate
      entry.remoteTag = note.tag
      entry.lastSeenGeneration = generation
      entry.lastSeenAt = Date.now()
      if (entry.state !== 'failed') entry.state = 'active'
    })
  }

  async markXiaomiNoteSyncFailed(noteId: string, generation: string, error: unknown) {
    const message = this.safeRetrievalError(error)
    await this.mutate((state) => {
      const entry = state.syncLedger.find((item) => item.source === 'xiaomi-note' && item.sourceItemId === noteId)
      if (!entry) return
      entry.lastSeenGeneration = generation
      entry.lastSeenAt = Date.now()
      entry.state = 'failed'
      entry.lastError = message
      entry.retryCount += 1
    })
  }

  async upsertXiaomiNote(note: XiaomiNote, generation: string) {
    const sourceItemId = String(note.id)
    const sourceRevision = `${Number(note.modifyDate) || 0}:${String(note.tag || '')}`
    const title = this.normalizeTitle(note.title || '未命名小米笔记')
    const content = this.normalizeContent(note.content?.trim() || note.preview?.trim() || title)
    const contentHash = digest(content)
    let outcome: 'created' | 'updated' | 'skipped' = 'created'
    let documentId = ''
    let previousChunks: RagChunk[] = []
    let nextChunks: RagChunk[] = []
    await this.mutate((state) => {
      let ledger = state.syncLedger.find((item) => item.source === 'xiaomi-note' && item.sourceItemId === sourceItemId)
      let index = ledger ? state.documents.findIndex((document) => document.id === ledger!.ragDocumentId) : -1
      if (index < 0) index = state.documents.findIndex((document) => document.source === 'xiaomi-note' && document.sourceItemId === sourceItemId)
      const current = index >= 0 ? state.documents[index] : undefined
      const now = Date.now()
      if (current) {
        documentId = current.id
        previousChunks = state.chunks.filter((chunk) => chunk.documentId === current.id)
        const contentChanged = current.contentHash !== contentHash
        nextChunks = contentChanged ? this.indexer.index(current.id, content, previousChunks) : previousChunks
        const sourceTags = ['小米笔记']
        const userTags = current.userTags || []
        const tags = this.normalizeTags([...sourceTags, ...userTags])
        const metadataChanged = current.title !== title || current.sourceRevision !== sourceRevision || current.tags.join('\0') !== tags.join('\0')
        outcome = contentChanged || metadataChanged ? 'updated' : 'skipped'
        state.documents[index] = {
          ...current,
          title,
          content,
          contentHash,
          summary: this.createSummary(content),
          tags,
          source: 'xiaomi-note',
          sourceItemId,
          sourceRevision,
          sourceManaged: true,
          userTags,
          vectorState: current.privacy === 'secret'
            ? 'local-only'
            : contentChanged ? this.nextVectorState(state.embeddingSettings) : current.vectorState,
          sensitiveFindings: contentChanged ? this.scanSensitive(content) : current.sensitiveFindings,
          injectionFindings: contentChanged ? this.injectionScanner.scan(content) : current.injectionFindings,
          chunkCount: nextChunks.length,
          updatedAt: Math.max(now, Number(note.modifyDate) || now),
          indexedAt: contentChanged ? now : current.indexedAt
        }
        if (contentChanged) state.chunks = [...state.chunks.filter((chunk) => chunk.documentId !== current.id), ...nextChunks]
      } else {
        if (state.documents.length >= MAX_DOCUMENTS) throw new BadRequestException('RAG document limit reached')
        documentId = ledger?.ragDocumentId || randomUUID()
        nextChunks = this.indexer.index(documentId, content)
        const nowCreated = Number(note.createDate) || now
        const privacy: RagPrivacy = state.embeddingSettings.xiaomiDefaultPrivacy || 'private'
        const document: RagDocument = {
          id: documentId,
          title,
          content,
          contentHash,
          summary: this.createSummary(content),
          tags: ['小米笔记'],
          userTags: [],
          privacy,
          mimeType: 'text/plain',
          source: 'xiaomi-note',
          sourceItemId,
          sourceRevision,
          sourceManaged: true,
          vectorState: this.nextVectorState(state.embeddingSettings),
          sensitiveFindings: this.scanSensitive(content),
          injectionFindings: this.injectionScanner.scan(content),
          chunkCount: nextChunks.length,
          createdAt: nowCreated,
          updatedAt: Math.max(now, Number(note.modifyDate) || now),
          indexedAt: now
        }
        state.documents.push(document)
        state.chunks.push(...nextChunks)
        outcome = 'created'
      }
      const entry: RagSyncLedgerEntry = {
        source: 'xiaomi-note',
        sourceItemId,
        ragDocumentId: documentId,
        remoteModifyDate: Number(note.modifyDate) || 0,
        remoteTag: String(note.tag || ''),
        contentHash,
        lastSeenGeneration: generation,
        lastSeenAt: now,
        lastIndexedAt: now,
        state: 'active',
        retryCount: 0
      }
      if (ledger) Object.assign(ledger, entry)
      else state.syncLedger.push(entry)
      this.assertStateLimits(state)
    })
    await this.syncResourceIndex()
    const finalOutcome = outcome as 'created' | 'updated' | 'skipped'
    const dense = finalOutcome === 'skipped'
      ? { vectorized: false, localOnly: false }
      : await this.refreshDenseDocument(documentId, previousChunks, nextChunks)
    return { outcome: finalOutcome, documentId, ...dense }
  }

  async finalizeXiaomiGeneration(generation: string) {
    const removedDocumentIds: string[] = []
    await this.mutate((state) => {
      const now = Date.now()
      for (const entry of state.syncLedger) {
        if (entry.source !== 'xiaomi-note' || entry.state === 'deleted' || entry.lastSeenGeneration === generation) continue
        removedDocumentIds.push(entry.ragDocumentId)
        state.documents = state.documents.filter((document) => document.id !== entry.ragDocumentId)
        state.chunks = state.chunks.filter((chunk) => chunk.documentId !== entry.ragDocumentId)
        entry.state = 'deleted'
        entry.lastSeenAt = now
        entry.lastError = undefined
      }
    })
    await this.deleteDenseDocuments(removedDocumentIds)
    if (removedDocumentIds.length) await this.syncResourceIndex()
    return { deleted: removedDocumentIds.length }
  }

  async removeXiaomiSourceItem(sourceItemId: string) {
    const state = await this.readState()
    const entry = state.syncLedger.find((item) => item.source === 'xiaomi-note' && item.sourceItemId === sourceItemId && item.state !== 'deleted')
    if (!entry) return { deleted: false }
    await this.mutate((draft) => {
      const current = draft.syncLedger.find((item) => item.source === 'xiaomi-note' && item.sourceItemId === sourceItemId)
      if (!current) return
      draft.documents = draft.documents.filter((document) => document.id !== current.ragDocumentId)
      draft.chunks = draft.chunks.filter((chunk) => chunk.documentId !== current.ragDocumentId)
      current.state = 'deleted'
      current.lastSeenAt = Date.now()
    })
    await this.deleteDenseDocuments([entry.ragDocumentId])
    await this.syncResourceIndex()
    return { deleted: true }
  }

  async rebuildVectorIndex() {
    const initial = await this.readState()
    const settings = this.resolveEmbeddingSettings(initial.embeddingSettings)
    const providerStatus = this.aliyunEmbeddingProvider.getStatus(settings)
    if (!settings.enabled) throw new ServiceUnavailableException('Dense semantic retrieval is disabled')
    if (!providerStatus.configured) throw new ServiceUnavailableException('Aliyun embedding API Key is not configured')
    const version = this.aliyunEmbeddingProvider.getVersion(settings)
    await this.vectorStore.clearVersion(version)
    await this.mutate((state) => {
      state.embeddingSettings.pendingVectorVersion = version
      for (const document of state.documents) {
        document.vectorState = document.privacy === 'secret' ? 'local-only' : 'pending'
      }
    })
    let vectorized = 0
    let failed = 0
    const snapshot = await this.readState()
    for (const document of snapshot.documents) {
      if (document.privacy === 'secret') continue
      const chunks = snapshot.chunks.filter((chunk) => chunk.documentId === document.id && chunk.injectionRisk !== 'high')
      try {
        await this.embedAndUpsert(version, chunks, settings, document)
        vectorized += chunks.length
        await this.setDocumentVectorState(document.id, 'ready', version)
      } catch {
        failed += 1
        await this.setDocumentVectorState(document.id, 'failed', version)
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    if (failed) throw new ServiceUnavailableException(`Dense vector rebuild failed for ${failed} document(s); the previous index remains active`)
    if (snapshot.documents.some((document) => document.privacy !== 'secret')) await this.vectorStore.activateVersion(version)
    await this.mutate((state) => {
      state.embeddingSettings.activeVectorVersion = version
      state.embeddingSettings.pendingVectorVersion = undefined
    })
    return { ok: true, version, documents: snapshot.documents.length, vectorized }
  }

  async getVectorIndexStatus() {
    const state = await this.readState()
    return {
      store: await this.vectorStore.getStatus(),
      settings: this.resolveEmbeddingSettings(state.embeddingSettings),
      coverage: {
        ready: state.documents.filter((document) => document.vectorState === 'ready').length,
        pending: state.documents.filter((document) => document.vectorState === 'pending').length,
        failed: state.documents.filter((document) => document.vectorState === 'failed').length,
        localOnly: state.documents.filter((document) => document.privacy === 'secret' || document.vectorState === 'local-only').length
      }
    }
  }

  async query(input: RagQueryInput) {
    const query = this.normalizeQuery(input.query)
    const maxPrivacy = this.normalizePrivacy(input.maxPrivacy || 'private')
    const limit = this.normalizeLimit(input.limit)
    const includeFlagged = input.includeFlagged === undefined ? false : this.normalizeBoolean(input.includeFlagged, 'includeFlagged')
    const providerMode = this.normalizeQueryProvider(input.provider)
    const external = providerMode === 'external'
    if (external) {
      if (input.externalConsent !== true) throw new BadRequestException('External RAG requires explicit consent for this query')
      if (maxPrivacy === 'secret') throw new BadRequestException('Secret documents cannot be sent to an external RAG provider')
      if (includeFlagged) throw new BadRequestException('Prompt-injection flagged chunks cannot be sent to an external RAG provider')
      if (this.scanSensitive(query).some((finding) => finding.severity === 'high')) {
        throw new BadRequestException('The query contains high-risk sensitive data and cannot be sent to an external RAG provider')
      }
      this.externalProvider.ensureConfigured()
    }
    const documentIds = this.normalizeDocumentIds(input.documentIds)
    const state = await this.readState()
    const queryHasHighRiskSensitiveData = this.scanSensitive(query).some((finding) => finding.severity === 'high')
    const settings = this.resolveEmbeddingSettings(state.embeddingSettings)
    const cacheKey = JSON.stringify([state.revision, settings.activeVectorVersion, query, maxPrivacy, limit, includeFlagged, documentIds, providerMode])
    if (!external) {
      const cached = this.queryCache.get(cacheKey)
      if (cached) return structuredClone(cached)
    }

    const documentIdSet = documentIds.length ? new Set(documentIds) : undefined
    const documents = new Map(state.documents.map((document) => [document.id, document]))
    const sensitiveTitleIds = external
      ? new Set(state.documents.filter((document) => this.scanSensitive(document.title).some((finding) => finding.severity === 'high')).map((document) => document.id))
      : undefined
    const excluded = { privacy: 0, flagged: 0, sensitive: 0, duplicate: 0 }
    const eligible: Array<{ chunk: RagChunk; document: RagDocument }> = []

    for (const chunk of state.chunks) {
      const document = documents.get(chunk.documentId)
      if (!document || (documentIdSet && !documentIdSet.has(document.id))) continue
      if (PRIVACY_WEIGHT[document.privacy] > PRIVACY_WEIGHT[maxPrivacy]) { excluded.privacy += 1; continue }
      if (chunk.injectionRisk === 'high' && !includeFlagged) { excluded.flagged += 1; continue }
      if (external && (sensitiveTitleIds!.has(document.id) || document.sensitiveFindings.some((finding) => finding.severity === 'high'))) { excluded.sensitive += 1; continue }
      eligible.push({ chunk, document })
    }

    const queryTokens = tokenizeText(query)
    if (!queryTokens.length) throw new BadRequestException('Query does not contain searchable terms')
    const queryTerms = termFrequency(queryTokens)
    const uniqueTerms = Object.keys(queryTerms)
    const documentFrequency = new Map<string, number>()
    for (const term of uniqueTerms) {
      let count = 0
      for (const item of eligible) if (item.chunk.terms[term]) count += 1
      documentFrequency.set(term, count)
    }
    const averageLength = eligible.length ? eligible.reduce((sum, item) => sum + item.chunk.tokenCount, 0) / eligible.length : 1
    const localQueryVector = this.embeddingProvider.embed(query)
    const candidates: Candidate[] = eligible.map(({ chunk, document }) => ({
      chunk,
      document,
      keywordRaw: bm25(chunk, uniqueTerms, documentFrequency, eligible.length, averageLength),
      vectorScore: Math.max(0, cosineSimilarity(localQueryVector, chunk.vector)),
      titleBoost: this.titleBoost(document, uniqueTerms),
      score: 0
    }))
    const maxKeyword = Math.max(0, ...candidates.map((candidate) => candidate.keywordRaw))
    for (const candidate of candidates) {
      const keyword = maxKeyword ? candidate.keywordRaw / maxKeyword : 0
      candidate.score = 0.65 * keyword + 0.35 * candidate.vectorScore + candidate.titleBoost
      if (candidate.chunk.injectionRisk === 'medium') candidate.score *= 0.8
    }

    let externalRequests = false
    let retrievalMode: 'hybrid' | 'local' = 'local'
    let retrievalReason = queryHasHighRiskSensitiveData ? 'The query contains high-risk sensitive data; dense query embedding was skipped' : ''
    const denseStatus = this.aliyunEmbeddingProvider.getStatus(settings)
    if (!external && !queryHasHighRiskSensitiveData && settings.activeVectorVersion && denseStatus.configured) {
      try {
        externalRequests = true
        const denseQuery = await this.aliyunEmbeddingProvider.embedQuery(query, settings)
        const denseMatches = await this.vectorStore.search(settings.activeVectorVersion, denseQuery, {
          limit: Math.max(limit * 8, 32),
          documentIds,
          maxPrivacy,
          includeFlagged
        })
        const denseByChunk = new Map(denseMatches.map((match) => [match.chunkId, match.score]))
        for (const candidate of candidates) {
          const denseScore = denseByChunk.get(candidate.chunk.id) || 0
          candidate.vectorScore = denseScore
          candidate.score = 0.45 * candidate.score + 0.55 * denseScore
          if (candidate.chunk.injectionRisk === 'medium') candidate.score *= 0.8
        }
        retrievalMode = 'hybrid'
      } catch (error) {
        retrievalReason = this.safeRetrievalError(error)
      }
    } else if (!retrievalReason) {
      retrievalReason = !settings.enabled
        ? 'Dense semantic retrieval is disabled'
        : !settings.activeVectorVersion
          ? 'The dense vector index is not ready'
          : !denseStatus.configured
            ? 'Aliyun embedding API Key is not configured'
            : 'Dense semantic retrieval is unavailable'
    }
    candidates.sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt)

    if (external && candidates.length) {
      const rerankCandidates = candidates.slice(0, 24)
      const similarities = await this.externalProvider.similarityScores(query, rerankCandidates.map((candidate) => candidate.chunk.text))
      externalRequests = true
      const similarityByChunk = new Map(rerankCandidates.map((candidate, index) => [candidate.chunk.id, similarities[index]]))
      for (const candidate of candidates) {
        const similarity = similarityByChunk.get(candidate.chunk.id)
        if (similarity === undefined) {
          candidate.score *= 0.12
          continue
        }
        candidate.vectorScore = similarity
        candidate.score = 0.2 * candidate.score + 0.8 * similarity
        if (candidate.chunk.injectionRisk === 'medium') candidate.score *= 0.8
      }
      candidates.sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt)
    }

    const citations: RagCitation[] = []
    const externalEvidence: Array<{ number: number; title: string; heading: string; text: string }> = []
    const contentHashes = new Set<string>()
    const perDocument = new Map<string, number>()
    for (const candidate of candidates) {
      if (candidate.score < 0.04 || citations.length >= limit) break
      if (contentHashes.has(candidate.chunk.contentHash)) { excluded.duplicate += 1; continue }
      if ((perDocument.get(candidate.document.id) || 0) >= 3) continue
      contentHashes.add(candidate.chunk.contentHash)
      perDocument.set(candidate.document.id, (perDocument.get(candidate.document.id) || 0) + 1)
      citations.push({
        number: citations.length + 1,
        documentId: candidate.document.id,
        documentTitle: candidate.document.title,
        chunkId: candidate.chunk.id,
        heading: candidate.chunk.heading,
        excerpt: bestExcerpt(candidate.chunk.text, uniqueTerms),
        score: round(candidate.score, 4),
        keywordScore: round(maxKeyword ? candidate.keywordRaw / maxKeyword : 0, 4),
        vectorScore: round(candidate.vectorScore, 4),
        privacy: candidate.document.privacy,
        injectionRisk: candidate.chunk.injectionRisk,
        updatedAt: candidate.document.updatedAt
      })
      externalEvidence.push({
        number: citations.length,
        title: candidate.document.title,
        heading: candidate.chunk.heading,
        text: candidate.chunk.text
      })
    }

    let answer = buildExtractiveAnswer(citations)
    let answerProvider = 'local-extractive-v1'
    if (external && externalEvidence.length) {
      answer = await this.externalProvider.generateAnswer(query, externalEvidence)
      answerProvider = this.externalProvider.getStatus().answerModel || 'openai-compatible'
      externalRequests = true
    } else if (external) {
      answerProvider = 'local-no-evidence-v1'
    }

    const result: RagQueryResult = {
      query,
      answer,
      confidence: confidenceFor(citations),
      citations,
      queryWarnings: this.injectionScanner.scan(query),
      excluded,
      provider: {
        mode: providerMode,
        embedding: external
          ? this.externalProvider.getStatus().embeddingModel || 'openai-compatible'
          : retrievalMode === 'hybrid' ? settings.model : this.embeddingProvider.id,
        answer: answerProvider,
        externalRequests
      },
      generatedAt: Date.now(),
      retrieval: { mode: retrievalMode, reason: retrievalReason || undefined }
    }
    if (!external) this.cacheResult(cacheKey, result)
    return structuredClone(result)
  }

  private nextVectorState(settings: RagEmbeddingSettings) {
    if (!settings.enabled) return 'disabled' as const
    return 'pending' as const
  }

  private async refreshDenseDocument(documentId: string, previousChunks: RagChunk[], nextChunks: RagChunk[]) {
    const state = await this.readState()
    const document = state.documents.find((item) => item.id === documentId)
    if (!document) return { vectorized: false, localOnly: false }
    const settings = this.resolveEmbeddingSettings(state.embeddingSettings)
    const versions = [settings.activeVectorVersion, settings.pendingVectorVersion].filter(Boolean) as string[]
    if (document.privacy === 'secret') {
      for (const version of new Set(versions)) await this.vectorStore.deleteByDocumentIds(version, [documentId]).catch(() => undefined)
      await this.setDocumentVectorState(documentId, 'local-only')
      return { vectorized: false, localOnly: true }
    }
    const version = settings.activeVectorVersion
    if (!settings.enabled || !version || this.aliyunEmbeddingProvider.getVersion(settings) !== version) {
      await this.setDocumentVectorState(documentId, settings.enabled ? 'pending' : 'disabled')
      return { vectorized: false, localOnly: false }
    }
    const previousIds = new Set(previousChunks.map((chunk) => chunk.id))
    const nextIds = new Set(nextChunks.map((chunk) => chunk.id))
    const removedIds = [...previousIds].filter((id) => !nextIds.has(id))
    const changed = document.vectorVersion === version
      ? nextChunks.filter((chunk) => !previousIds.has(chunk.id))
      : nextChunks
    try {
      if (removedIds.length) await this.vectorStore.deleteByChunkIds(version, removedIds)
      await this.embedAndUpsert(version, changed.filter((chunk) => chunk.injectionRisk !== 'high'), settings, document)
      await this.setDocumentVectorState(documentId, 'ready', version)
      return { vectorized: changed.length > 0, localOnly: false }
    } catch {
      await this.setDocumentVectorState(documentId, 'failed', version)
      return { vectorized: false, localOnly: false }
    }
  }

  private async embedAndUpsert(version: string, chunks: RagChunk[], settings: RagEmbeddingSettings, document: RagDocument) {
    for (let offset = 0; offset < chunks.length; offset += settings.batchSize) {
      const batch = chunks.slice(offset, offset + settings.batchSize)
      const embeddings = await this.aliyunEmbeddingProvider.embedDocuments(batch.map((chunk) => ({ id: chunk.id, text: chunk.text })), settings)
      const vectors = new Map(embeddings.map((item) => [item.id, item.vector]))
      await this.vectorStore.upsert(version, batch.map((chunk) => ({
        chunkId: chunk.id,
        documentId: document.id,
        contentHash: chunk.contentHash,
        privacy: document.privacy as 'public' | 'private',
        injectionRisk: chunk.injectionRisk,
        vectorVersion: version,
        vector: vectors.get(chunk.id)!
      })))
    }
  }

  private async setDocumentVectorState(documentId: string, vectorState: RagDocument['vectorState'], vectorVersion?: string) {
    await this.mutate((state) => {
      const document = state.documents.find((item) => item.id === documentId)
      if (!document) return
      document.vectorState = vectorState
      document.vectorVersion = vectorVersion
    })
  }

  private async deleteDenseDocuments(documentIds: string[]) {
    if (!documentIds.length) return
    const state = await this.readState()
    const versions = [state.embeddingSettings.activeVectorVersion, state.embeddingSettings.pendingVectorVersion].filter(Boolean) as string[]
    for (const version of new Set(versions)) await this.vectorStore.deleteByDocumentIds(version, documentIds).catch(() => undefined)
  }

  private queueDenseRefresh(documentId: string, previousChunks: RagChunk[], nextChunks: RagChunk[]) {
    this.denseQueue = this.denseQueue.then(async () => {
      await this.refreshDenseDocument(documentId, previousChunks, nextChunks)
    }).catch(() => undefined)
  }

  private async createDocument(input: CreateRagDocumentInput, sourceResourceId?: string) {
    let created!: RagDocument
    await this.mutate((state) => {
      if (state.documents.length >= MAX_DOCUMENTS) throw new BadRequestException('RAG document limit reached')
      const now = Date.now()
      const id = randomUUID()
      const title = this.normalizeTitle(input.title)
      const content = this.normalizeContent(input.content)
      const contentHash = digest(content)
      if (state.documents.some((document) => document.contentHash === contentHash)) throw new ConflictException('An identical document already exists')
      const chunks = this.indexer.index(id, content)
      created = {
        id,
        title,
        content,
        contentHash,
        summary: this.createSummary(content),
        tags: this.normalizeTags(input.tags || []),
        privacy: this.normalizePrivacy(input.privacy || 'private'),
        mimeType: this.normalizeMimeType(input.mimeType || 'text/plain'),
        source: input.source || 'manual',
        sourceResourceId,
        sourceManaged: false,
        userTags: this.normalizeTags(input.tags || []),
        vectorState: this.nextVectorState(state.embeddingSettings),
        originalFilename: this.normalizeOptionalFilename(input.originalFilename),
        sensitiveFindings: this.scanSensitive(content),
        injectionFindings: this.injectionScanner.scan(content),
        chunkCount: chunks.length,
        createdAt: now,
        updatedAt: now,
        indexedAt: now
      }
      state.documents.push(created)
      state.chunks.push(...chunks)
      this.assertStateLimits(state)
    })
    await this.syncResourceIndex()
    this.queueDenseRefresh(created.id, [], (await this.readState()).chunks.filter((chunk) => chunk.documentId === created.id))
    return structuredClone(created)
  }

  private createDefaultState(): RagState {
    return {
      version: 2,
      revision: 0,
      documents: [],
      chunks: [],
      syncLedger: [],
      embeddingSettings: structuredClone(DEFAULT_RAG_EMBEDDING_SETTINGS)
    }
  }

  private migrateLegacyState(state: LegacyRagState): RagState {
    return {
      version: 2,
      revision: Math.max(0, Math.trunc(state.revision || 0)) + 1,
      documents: state.documents.map((document) => ({
        ...document,
        sourceManaged: false,
        userTags: [...document.tags],
        vectorState: document.privacy === 'secret' ? 'local-only' : 'disabled'
      })),
      chunks: state.chunks,
      syncLedger: [],
      embeddingSettings: structuredClone(DEFAULT_RAG_EMBEDDING_SETTINGS)
    }
  }

  private async readState(): Promise<RagState> {
    if (this.stateCache) return this.stateCache
    const persisted = await this.store.read()
    if (persisted.version === 2) {
      this.stateCache = persisted
      return persisted
    }
    const migrated = this.migrateLegacyState(persisted)
    await this.store.createRecoveryCopy('pre-rag-v2')
    const saved = await this.store.replace(migrated)
    if (saved.version !== 2) throw new Error('RAG migration did not produce a v2 state')
    this.stateCache = saved
    return saved
  }

  private async mutate(mutator: (state: RagState) => void | Promise<void>) {
    await this.readState()
    const persisted = await this.store.update(async (state) => {
      if (state.version !== 2) throw new Error('RAG state migration is incomplete')
      await mutator(state)
      state.revision = Math.max(0, Math.trunc(state.revision || 0)) + 1
      return state
    })
    if (persisted.version !== 2) throw new Error('RAG state migration is incomplete')
    const next = persisted
    this.stateCache = next
    this.queryCache.clear()
    return next
  }

  private async syncResourceIndex() {
    try {
      const state = await this.readState()
      const resources: Resource[] = state.documents.map((document) => ({
        id: `upload:document:${document.id}`,
        type: 'document',
        source: 'upload',
        sourceId: document.id,
        title: document.title,
        summary: document.summary,
        content: document.content,
        tags: document.tags,
        privacy: document.privacy,
        context: {
          projects: [],
          time: { startAt: document.createdAt, endAt: document.updatedAt },
          locations: []
        },
        archived: false,
        deleted: false,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        indexedAt: Date.now(),
        metadata: {
          mimeType: document.mimeType,
          source: document.source,
          sourceResourceId: document.sourceResourceId,
          originalFilename: document.originalFilename,
          chunkCount: document.chunkCount,
          sensitiveFindingCount: document.sensitiveFindings.length,
          injectionFindingCount: document.injectionFindings.length,
          contentHash: document.contentHash
        }
      }))
      await this.resourcesService.replaceSourceResources('upload', 'document', resources)
      this.resourceSyncError = ''
    } catch (error) {
      this.resourceSyncError = error instanceof Error ? error.message.slice(0, 240) : 'RAG Resource sync failed'
      console.warn('RAG Resource index sync failed', this.resourceSyncError)
    }
  }

  private toSummary(document: RagDocument): RagDocumentSummary {
    const { content: _content, sensitiveFindings, injectionFindings, ...summary } = document
    return {
      ...summary,
      sensitiveFindingCount: sensitiveFindings.length,
      highSensitiveFindingCount: sensitiveFindings.filter((finding) => finding.severity === 'high').length,
      injectionFindingCount: injectionFindings.length,
      highInjectionFindingCount: injectionFindings.filter((finding) => finding.severity === 'high').length
    }
  }

  private scanSensitive(content: string) {
    return this.privacyScanner.scan(content).map((finding): RagSensitiveFinding => ({ ...finding }))
  }

  private titleBoost(document: RagDocument, terms: string[]) {
    const haystack = `${document.title} ${document.tags.join(' ')}`.normalize('NFKC').toLocaleLowerCase('zh-CN')
    const matches = terms.filter((term) => haystack.includes(term)).length
    return Math.min(0.12, matches * 0.025)
  }

  private mergeSourceAndUserTags(document: RagDocument, userTags: string[]) {
    const previousUserTags = new Set(document.userTags || [])
    const sourceTags = document.tags.filter((tag) => !previousUserTags.has(tag))
    return this.normalizeTags([...sourceTags, ...userTags])
  }

  private resolveEmbeddingSettings(stored: RagEmbeddingSettings): RagEmbeddingSettings {
    const settings = { ...structuredClone(DEFAULT_RAG_EMBEDDING_SETTINGS), ...structuredClone(stored) }
    const baseUrl = process.env.TERRA_RAG_ALIYUN_BASE_URL?.trim()
    const model = process.env.TERRA_RAG_ALIYUN_MODEL?.trim()
    const dimensions = this.parseEnvironmentInteger('TERRA_RAG_ALIYUN_DIMENSIONS')
    const batchSize = this.parseEnvironmentInteger('TERRA_RAG_ALIYUN_BATCH_SIZE')
    const timeoutMs = this.parseEnvironmentInteger('TERRA_RAG_ALIYUN_TIMEOUT_MS')
    if (baseUrl) settings.baseUrl = this.normalizeEmbeddingBaseUrl(baseUrl)
    if (model) settings.model = this.normalizeEmbeddingModel(model)
    if (dimensions !== undefined) settings.dimensions = this.normalizeEmbeddingDimensions(dimensions)
    if (batchSize !== undefined) settings.batchSize = this.normalizeInteger(batchSize, 'TERRA_RAG_ALIYUN_BATCH_SIZE', 1, 10)
    if (timeoutMs !== undefined) settings.timeoutMs = this.normalizeInteger(timeoutMs, 'TERRA_RAG_ALIYUN_TIMEOUT_MS', 1_000, 120_000)
    return settings
  }

  private embeddingEnvironmentOverrides() {
    return [
      'TERRA_RAG_ALIYUN_BASE_URL',
      'TERRA_RAG_ALIYUN_MODEL',
      'TERRA_RAG_ALIYUN_DIMENSIONS',
      'TERRA_RAG_ALIYUN_BATCH_SIZE',
      'TERRA_RAG_ALIYUN_TIMEOUT_MS'
    ].filter((name) => Boolean(process.env[name]?.trim()))
  }

  private parseEnvironmentInteger(name: string) {
    const raw = process.env[name]?.trim()
    if (!raw) return undefined
    const value = Number(raw)
    if (!Number.isSafeInteger(value)) throw new ServiceUnavailableException(`${name} is invalid`)
    return value
  }

  private normalizeEmbeddingBaseUrl(value: unknown) {
    if (typeof value !== 'string' || value.length > 500) throw new BadRequestException('Embedding base URL is invalid')
    try {
      const url = new URL(value.trim())
      const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error()
      if (url.username || url.password || url.search || url.hash) throw new Error()
      return url.toString().replace(/\/+$/, '')
    } catch { throw new BadRequestException('Embedding base URL must be HTTPS (HTTP is allowed only for loopback tests)') }
  }

  private normalizeEmbeddingModel(value: unknown) {
    if (typeof value !== 'string') throw new BadRequestException('Embedding model must be text')
    const model = value.trim()
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) throw new BadRequestException('Embedding model is invalid')
    return model
  }

  private normalizeEmbeddingDimensions(value: unknown) {
    const dimensions = Number(value)
    if (![64, 128, 256, 512, 768, 1024].includes(dimensions)) throw new BadRequestException('Embedding dimensions are unsupported')
    return dimensions
  }

  private normalizeInteger(value: unknown, label: string, minimum: number, maximum: number) {
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new BadRequestException(`${label} is out of range`)
    return number
  }

  private normalizeOptionalBudget(value: unknown) {
    if (value === null || value === '' || value === 0) return undefined
    return this.normalizeInteger(value, 'dailyTokenBudget', 1, 100_000_000)
  }

  private normalizeTitle(value: unknown) {
    if (typeof value !== 'string') throw new BadRequestException('Document title must be text')
    const title = value.trim()
    if (!title) throw new BadRequestException('Document title is required')
    if (title.length > 300) throw new BadRequestException('Document title exceeds 300 characters')
    return title
  }

  private normalizeContent(value: unknown) {
    if (typeof value !== 'string') throw new BadRequestException('Document content must be text')
    if (value.includes('\0')) throw new BadRequestException('Document content contains unsupported null bytes')
    const content = value.replace(/\r\n?/g, '\n').trimEnd()
    if (!content.trim()) throw new BadRequestException('Document content is required')
    if (content.length > MAX_CONTENT_CHARS || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
      throw new BadRequestException(`Document exceeds the ${MAX_CONTENT_CHARS} character or ${MAX_CONTENT_BYTES} byte limit`)
    }
    return content
  }

  private normalizeTags(value: unknown) {
    if (!Array.isArray(value)) throw new BadRequestException('Document tags must be an array')
    const tags = value.map((tag) => {
      if (typeof tag !== 'string') throw new BadRequestException('Document tag must be text')
      const clean = tag.trim()
      if (clean.length > 64) throw new BadRequestException('Document tag exceeds 64 characters')
      return clean
    }).filter(Boolean)
    const unique = [...new Set(tags)]
    if (unique.length > 30) throw new BadRequestException('Document has too many tags')
    return unique
  }

  private normalizePrivacy(value: unknown) {
    if (typeof value !== 'string' || !PRIVACY.has(value as RagPrivacy)) throw new BadRequestException('Invalid document privacy level')
    return value as RagPrivacy
  }

  private normalizeMimeType(value: unknown) {
    if (typeof value !== 'string' || !MIME_TYPES.has(value as RagMimeType)) throw new BadRequestException('Unsupported document type')
    return value as RagMimeType
  }

  private normalizeOptionalFilename(value: unknown) {
    if (value === undefined || value === '') return undefined
    if (typeof value !== 'string') throw new BadRequestException('Original filename must be text')
    const filename = value.trim()
    if (filename.length > 260) throw new BadRequestException('Original filename is too long')
    if (/[\0\r\n]/.test(filename)) throw new BadRequestException('Original filename is invalid')
    return filename
  }

  private normalizeQuery(value: unknown) {
    if (typeof value !== 'string') throw new BadRequestException('Query must be text')
    const query = value.trim().replace(/\s+/g, ' ')
    if (!query) throw new BadRequestException('Query is required')
    if (query.length > 500) throw new BadRequestException('Query exceeds 500 characters')
    return query
  }

  private normalizeLimit(value: unknown) {
    if (value === undefined) return 8
    const number = Number(value)
    if (!Number.isInteger(number) || number < 1 || number > 12) throw new BadRequestException('Query limit must be between 1 and 12')
    return number
  }

  private normalizeBoolean(value: unknown, label: string) {
    if (typeof value !== 'boolean') throw new BadRequestException(`${label} must be a boolean`)
    return value
  }

  private normalizeQueryProvider(value: unknown): RagQueryProvider {
    if (value === undefined || value === 'local') return 'local'
    if (value === 'external') return 'external'
    throw new BadRequestException('Query provider must be local or external')
  }

  private normalizeDocumentIds(value: unknown) {
    if (value === undefined) return []
    if (!Array.isArray(value) || value.length > 100) throw new BadRequestException('Invalid document filter')
    return [...new Set(value.map((id) => this.assertUuid(id)))].sort()
  }

  private createSummary(content: string) {
    return content.replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 500)
  }

  private requireDocument(state: RagState, id: string) {
    const safeId = this.assertUuid(id)
    const document = state.documents.find((item) => item.id === safeId)
    if (!document) throw new NotFoundException('RAG document was not found')
    return document
  }

  private assertUuid(value: unknown) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException('Invalid document ID')
    }
    return value
  }

  private assertStateLimits(state: RagState) {
    if (state.documents.length > MAX_DOCUMENTS) throw new BadRequestException('RAG document limit reached')
    if (state.chunks.length > MAX_CHUNKS) throw new BadRequestException('RAG chunk limit reached')
  }

  private safeRetrievalError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Dense semantic retrieval failed'
    return message.replace(/[\r\n]/g, ' ').slice(0, 240)
  }

  private cacheResult(key: string, result: RagQueryResult) {
    this.queryCache.set(key, structuredClone(result))
    if (this.queryCache.size > MAX_QUERY_CACHE) {
      const oldest = this.queryCache.keys().next().value as string | undefined
      if (oldest) this.queryCache.delete(oldest)
    }
  }

  private isPersistedState(value: unknown): value is RagState | LegacyRagState {
    const state = value as Partial<RagState | LegacyRagState>
    if (!state || !Number.isSafeInteger(state.revision) || !Array.isArray(state.documents) || !Array.isArray(state.chunks)) return false
    if (state.version !== 1 && state.version !== 2) return false
    if (state.documents.length > MAX_DOCUMENTS || state.chunks.length > MAX_CHUNKS) return false
    const documentIds = new Set<string>()
    for (const document of state.documents) {
      if (!this.isDocument(document, state.version === 1) || documentIds.has(document.id)) return false
      documentIds.add(document.id)
    }
    const chunkIds = new Set<string>()
    for (const chunk of state.chunks) {
      if (!this.isChunk(chunk) || !documentIds.has(chunk.documentId) || chunkIds.has(chunk.id)) return false
      chunkIds.add(chunk.id)
    }
    if (state.version === 1) return true
    const current = state as Partial<RagState>
    return Array.isArray(current.syncLedger) && current.syncLedger.length <= MAX_DOCUMENTS &&
      current.syncLedger.every((entry: unknown) => this.isSyncLedgerEntry(entry, documentIds)) &&
      this.isEmbeddingSettings(current.embeddingSettings)
  }

  private isDocument(value: unknown, legacy = false): value is RagDocument {
    const document = value as Partial<RagDocument>
    const sources = legacy ? ['manual', 'file', 'resource'] : ['manual', 'file', 'resource', 'xiaomi-note']
    return Boolean(
      document && typeof document.id === 'string' && typeof document.title === 'string' && document.title.length <= 300 &&
      typeof document.content === 'string' && document.content.length <= MAX_CONTENT_CHARS && typeof document.contentHash === 'string' && /^[a-f0-9]{64}$/.test(document.contentHash) &&
      typeof document.summary === 'string' && document.summary.length <= 500 && Array.isArray(document.tags) && document.tags.length <= 30 && document.tags.every((tag) => typeof tag === 'string' && tag.length <= 64) &&
      typeof document.privacy === 'string' && PRIVACY.has(document.privacy as RagPrivacy) && typeof document.mimeType === 'string' && MIME_TYPES.has(document.mimeType as RagMimeType) &&
      sources.includes(String(document.source)) && this.isOptionalString(document.sourceResourceId, 100) && this.isOptionalString(document.sourceItemId, 200) &&
      this.isOptionalString(document.sourceRevision, 200) && (document.sourceManaged === undefined || typeof document.sourceManaged === 'boolean') &&
      (document.userTags === undefined || (Array.isArray(document.userTags) && document.userTags.length <= 30 && document.userTags.every((tag) => typeof tag === 'string' && tag.length <= 64))) &&
      (document.vectorState === undefined || ['disabled', 'pending', 'ready', 'failed', 'local-only'].includes(String(document.vectorState))) &&
      this.isOptionalString(document.vectorVersion, 300) && this.isOptionalString(document.originalFilename, 260) &&
      Array.isArray(document.sensitiveFindings) && Array.isArray(document.injectionFindings) &&
      Number.isSafeInteger(document.chunkCount) && typeof document.createdAt === 'number' && typeof document.updatedAt === 'number' && typeof document.indexedAt === 'number'
    )
  }

  private isSyncLedgerEntry(value: unknown, documentIds: Set<string>): value is RagSyncLedgerEntry {
    const entry = value as Partial<RagSyncLedgerEntry>
    return Boolean(entry && entry.source === 'xiaomi-note' && typeof entry.sourceItemId === 'string' && entry.sourceItemId.length <= 200 &&
      typeof entry.ragDocumentId === 'string' && (entry.state === 'deleted' || documentIds.has(entry.ragDocumentId)) && Number.isFinite(entry.remoteModifyDate) &&
      this.isOptionalString(entry.remoteTag, 200) && typeof entry.contentHash === 'string' && /^[a-f0-9]{64}$/.test(entry.contentHash) &&
      typeof entry.lastSeenGeneration === 'string' && entry.lastSeenGeneration.length <= 100 && Number.isFinite(entry.lastSeenAt) &&
      (entry.lastIndexedAt === undefined || Number.isFinite(entry.lastIndexedAt)) && ['active', 'pending', 'failed', 'deleted'].includes(String(entry.state)) &&
      this.isOptionalString(entry.lastError, 500) && Number.isSafeInteger(entry.retryCount) && Number(entry.retryCount) >= 0)
  }

  private isEmbeddingSettings(value: unknown): value is RagEmbeddingSettings {
    const settings = value as Partial<RagEmbeddingSettings>
    return Boolean(settings && typeof settings.enabled === 'boolean' && settings.provider === 'aliyun' &&
      typeof settings.baseUrl === 'string' && settings.baseUrl.length <= 500 && typeof settings.model === 'string' && settings.model.length <= 100 &&
      Number.isSafeInteger(settings.dimensions) && Number(settings.dimensions) >= 64 && Number(settings.dimensions) <= 4096 &&
      Number.isSafeInteger(settings.batchSize) && Number(settings.batchSize) >= 1 && Number(settings.batchSize) <= 10 &&
      settings.concurrency === 1 && Number.isSafeInteger(settings.timeoutMs) && Number(settings.timeoutMs) >= 1_000 && Number(settings.timeoutMs) <= 120_000 &&
      Number.isSafeInteger(settings.retries) && Number(settings.retries) >= 0 && Number(settings.retries) <= 5 &&
      typeof settings.autoSyncXiaomi === 'boolean' && (settings.xiaomiDefaultPrivacy === undefined || PRIVACY.has(settings.xiaomiDefaultPrivacy)) && typeof settings.autoRetry === 'boolean' &&
      (settings.dailyTokenBudget === undefined || (Number.isSafeInteger(settings.dailyTokenBudget) && Number(settings.dailyTokenBudget) > 0)) &&
      this.isOptionalString(settings.activeVectorVersion, 300) && this.isOptionalString(settings.pendingVectorVersion, 300))
  }

  private isOptionalString(value: unknown, maxLength: number) {
    return value === undefined || (typeof value === 'string' && value.length <= maxLength)
  }

  private isChunk(value: unknown): value is RagChunk {
    const chunk = value as Partial<RagChunk>
    if (!chunk || typeof chunk.id !== 'string' || !/^[a-f0-9]{32}$/.test(chunk.id) || typeof chunk.documentId !== 'string') return false
    if (!Number.isSafeInteger(chunk.index) || typeof chunk.heading !== 'string' || chunk.heading.length > 300 || typeof chunk.text !== 'string' || chunk.text.length > 1_100) return false
    if (!Number.isSafeInteger(chunk.startOffset) || !Number.isSafeInteger(chunk.endOffset) || typeof chunk.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(chunk.contentHash)) return false
    if (!chunk.terms || typeof chunk.terms !== 'object' || Array.isArray(chunk.terms) || Object.keys(chunk.terms).length > 5_000) return false
    if (!Object.values(chunk.terms).every((count) => Number.isSafeInteger(count) && count > 0)) return false
    if (!Number.isSafeInteger(chunk.tokenCount) || !Array.isArray(chunk.vector) || chunk.vector.length > this.embeddingProvider.dimensions) return false
    if (!chunk.vector.every((item) => Array.isArray(item) && item.length === 2 && Number.isInteger(item[0]) && item[0] >= 0 && item[0] < this.embeddingProvider.dimensions && Number.isFinite(item[1]))) return false
    return ['none', 'medium', 'high'].includes(String(chunk.injectionRisk)) && Array.isArray(chunk.injectionSignals) && chunk.injectionSignals.every((signal) => typeof signal === 'string')
  }
}

function bm25(chunk: RagChunk, terms: string[], documentFrequency: Map<string, number>, corpusSize: number, averageLength: number) {
  if (!corpusSize) return 0
  const k1 = 1.2
  const b = 0.75
  let score = 0
  for (const term of terms) {
    const frequency = chunk.terms[term] || 0
    if (!frequency) continue
    const df = documentFrequency.get(term) || 0
    const inverseDocumentFrequency = Math.log(1 + (corpusSize - df + 0.5) / (df + 0.5))
    const denominator = frequency + k1 * (1 - b + b * chunk.tokenCount / Math.max(1, averageLength))
    score += inverseDocumentFrequency * frequency * (k1 + 1) / denominator
  }
  return score
}

function bestExcerpt(text: string, terms: string[]) {
  const clean = text.replace(/^# .+\n/, '').trim()
  const segments = clean.match(/[^。！？.!?\n]+[。！？.!?]?/g) || [clean]
  let best = segments[0] || clean
  let bestScore = -1
  for (const segment of segments) {
    const lower = segment.normalize('NFKC').toLocaleLowerCase('zh-CN')
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0)
    if (score > bestScore) { best = segment; bestScore = score }
  }
  if (best.length <= 320) return best.trim()
  return `${best.slice(0, 317).trimEnd()}...`
}

function buildExtractiveAnswer(citations: RagCitation[]) {
  if (!citations.length) return '在当前文档与隐私范围内没有找到足够相关的内容。'
  return citations.slice(0, 4).map((citation) => `${citation.excerpt} [${citation.number}]`).join('\n\n')
}

function confidenceFor(citations: RagCitation[]): RagConfidence {
  if (!citations.length) return 'none'
  const top = citations[0].score
  if (top >= 0.72 && citations.length >= 2) return 'high'
  if (top >= 0.45) return 'medium'
  return 'low'
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}
