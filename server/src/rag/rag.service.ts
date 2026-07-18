import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BlogPrivacyScanner } from '../blog/blog-privacy-scanner'
import type { Resource } from '../resources/resource.model'
import { ResourcesService } from '../resources/resources.service'
import { EncryptedJsonStore } from '../storage/encrypted-json.store'
import { getDataEncryptionSecret } from '../security/secrets'
import { cosineSimilarity, LocalHashEmbeddingProvider, termFrequency, tokenizeText } from './local-embedding.provider'
import { PromptInjectionScanner } from './prompt-injection-scanner'
import { digest, RagIndexer } from './rag-indexer'
import { ExternalRagProvider } from './external-rag.provider'
import type {
  CreateRagDocumentInput,
  RagChunk,
  RagCitation,
  RagConfidence,
  RagDocument,
  RagDocumentSummary,
  RagInjectionFinding,
  RagMimeType,
  RagPrivacy,
  RagQueryProvider,
  RagQueryInput,
  RagQueryResult,
  RagSensitiveFinding,
  RagState,
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
  private readonly store: EncryptedJsonStore<RagState>
  private readonly embeddingProvider = new LocalHashEmbeddingProvider()
  private readonly injectionScanner = new PromptInjectionScanner()
  private readonly indexer = new RagIndexer(this.embeddingProvider, this.injectionScanner)
  private readonly privacyScanner = new BlogPrivacyScanner()
  private readonly queryCache = new Map<string, RagQueryResult>()
  private stateCache?: RagState
  private resourceSyncError = ''

  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly externalProvider: ExternalRagProvider
  ) {
    const encryptionSecret = getDataEncryptionSecret()
    this.store = new EncryptedJsonStore<RagState>({
      filePath: process.env.TERRA_RAG_FILE || join(process.cwd(), 'data', 'rag.json'),
      encryptionSecret,
      encryptedFormat: 'terra-rag-state',
      defaultValue: () => ({ version: 1, revision: 0, documents: [], chunks: [] }),
      validate: (value): value is RagState => this.isState(value),
      maxPlaintextBytes: 256 * 1024 * 1024
    })
    void this.store.initialize()
  }

  async getStatus() {
    const state = await this.readState()
    const uniqueChunks = new Set(state.chunks.map((chunk) => chunk.contentHash)).size
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
      resourceSyncError: this.resourceSyncError || undefined
    }
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
    await this.mutate((state) => {
      const index = state.documents.findIndex((document) => document.id === safeId)
      if (index < 0) throw new NotFoundException('RAG document was not found')
      const current = state.documents[index]
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
      updated = {
        ...current,
        title,
        content,
        contentHash,
        summary: this.createSummary(content),
        tags: input.tags === undefined ? current.tags : this.normalizeTags(input.tags),
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
    return structuredClone(updated)
  }

  async remove(id: string) {
    const safeId = this.assertUuid(id)
    await this.mutate((state) => {
      if (!state.documents.some((document) => document.id === safeId)) throw new NotFoundException('RAG document was not found')
      state.documents = state.documents.filter((document) => document.id !== safeId)
      state.chunks = state.chunks.filter((chunk) => chunk.documentId !== safeId)
    })
    await this.syncResourceIndex()
    return { id: safeId, removed: true }
  }

  async reindexOne(id: string) {
    const safeId = this.assertUuid(id)
    let result!: RagDocument
    await this.mutate((state) => {
      const document = this.requireDocument(state, safeId)
      const previous = state.chunks.filter((chunk) => chunk.documentId === safeId)
      const chunks = this.indexer.index(safeId, document.content, previous)
      const indexedAt = Date.now()
      result = { ...document, chunkCount: chunks.length, indexedAt }
      state.documents[state.documents.findIndex((item) => item.id === safeId)] = result
      state.chunks = [...state.chunks.filter((chunk) => chunk.documentId !== safeId), ...chunks]
      this.assertStateLimits(state)
    })
    await this.syncResourceIndex()
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
    const cacheKey = JSON.stringify([state.revision, query, maxPrivacy, limit, includeFlagged, documentIds, providerMode])
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
    const queryVector = this.embeddingProvider.embed(query)
    const candidates: Candidate[] = eligible.map(({ chunk, document }) => ({
      chunk,
      document,
      keywordRaw: bm25(chunk, uniqueTerms, documentFrequency, eligible.length, averageLength),
      vectorScore: Math.max(0, cosineSimilarity(queryVector, chunk.vector)),
      titleBoost: this.titleBoost(document, uniqueTerms),
      score: 0
    }))
    const maxKeyword = Math.max(0, ...candidates.map((candidate) => candidate.keywordRaw))
    for (const candidate of candidates) {
      const keyword = maxKeyword ? candidate.keywordRaw / maxKeyword : 0
      candidate.score = 0.62 * keyword + 0.34 * candidate.vectorScore + candidate.titleBoost
      if (candidate.chunk.injectionRisk === 'medium') candidate.score *= 0.8
    }
    candidates.sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt)

    let externalRequests = false
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
        embedding: external ? this.externalProvider.getStatus().embeddingModel || 'openai-compatible' : this.embeddingProvider.id,
        answer: answerProvider,
        externalRequests
      },
      generatedAt: Date.now()
    }
    if (!external) this.cacheResult(cacheKey, result)
    return structuredClone(result)
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
    return structuredClone(created)
  }

  private async readState() {
    if (!this.stateCache) this.stateCache = await this.store.read()
    return this.stateCache
  }

  private async mutate(mutator: (state: RagState) => void | Promise<void>) {
    const next = await this.store.update(async (state) => {
      await mutator(state)
      state.revision = Math.max(0, Math.trunc(state.revision || 0)) + 1
    })
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

  private cacheResult(key: string, result: RagQueryResult) {
    this.queryCache.set(key, structuredClone(result))
    if (this.queryCache.size > MAX_QUERY_CACHE) {
      const oldest = this.queryCache.keys().next().value as string | undefined
      if (oldest) this.queryCache.delete(oldest)
    }
  }

  private isState(value: unknown): value is RagState {
    const state = value as Partial<RagState>
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.documents) || !Array.isArray(state.chunks)) return false
    if (state.documents.length > MAX_DOCUMENTS || state.chunks.length > MAX_CHUNKS) return false
    const documentIds = new Set<string>()
    for (const document of state.documents) {
      if (!this.isDocument(document) || documentIds.has(document.id)) return false
      documentIds.add(document.id)
    }
    const chunkIds = new Set<string>()
    for (const chunk of state.chunks) {
      if (!this.isChunk(chunk) || !documentIds.has(chunk.documentId) || chunkIds.has(chunk.id)) return false
      chunkIds.add(chunk.id)
    }
    return true
  }

  private isDocument(value: unknown): value is RagDocument {
    const document = value as Partial<RagDocument>
    return Boolean(
      document && typeof document.id === 'string' && typeof document.title === 'string' && document.title.length <= 300 &&
      typeof document.content === 'string' && document.content.length <= MAX_CONTENT_CHARS && typeof document.contentHash === 'string' && /^[a-f0-9]{64}$/.test(document.contentHash) &&
      typeof document.summary === 'string' && document.summary.length <= 500 && Array.isArray(document.tags) && document.tags.length <= 30 && document.tags.every((tag) => typeof tag === 'string' && tag.length <= 64) &&
      typeof document.privacy === 'string' && PRIVACY.has(document.privacy as RagPrivacy) && typeof document.mimeType === 'string' && MIME_TYPES.has(document.mimeType as RagMimeType) &&
      ['manual', 'file', 'resource'].includes(String(document.source)) && Array.isArray(document.sensitiveFindings) && Array.isArray(document.injectionFindings) &&
      Number.isSafeInteger(document.chunkCount) && typeof document.createdAt === 'number' && typeof document.updatedAt === 'number' && typeof document.indexedAt === 'number'
    )
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
