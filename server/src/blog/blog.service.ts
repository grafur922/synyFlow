import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ResourcesService } from '../resources/resources.service'
import type { Resource } from '../resources/resource.model'
import { EncryptedJsonStore } from '../storage/encrypted-json.store'
import { getDataEncryptionSecret } from '../security/secrets'
import { XiaomiNotesService } from '../xiaomi-notes/xiaomi-notes.service'
import { BlogPrivacyScanner } from './blog-privacy-scanner'
import type {
  BlogDraft,
  BlogPrivacy,
  BlogState,
  CreateBlogDraftInput,
  UpdateBlogDraftInput
} from './blog.model'
import { MarkdownBlogAdapter } from './markdown-blog.adapter'

const MAX_DRAFTS = 10_000
const MAX_CONTENT = 300_000
const MAX_TAGS = 30
const PRIVACY = new Set<BlogPrivacy>(['public', 'private', 'secret'])

@Injectable()
export class BlogService {
  private readonly store: EncryptedJsonStore<BlogState>
  private readonly scanner = new BlogPrivacyScanner()
  private readonly adapter = new MarkdownBlogAdapter()
  private resourceSyncError = ''

  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly xiaomiNotesService: XiaomiNotesService
  ) {
    const encryptionSecret = getDataEncryptionSecret()
    this.store = new EncryptedJsonStore<BlogState>({
      filePath: process.env.TERRA_BLOG_FILE || join(process.cwd(), 'data', 'blog.json'),
      encryptionSecret,
      encryptedFormat: 'terra-blog-state',
      defaultValue: () => ({ drafts: [] }),
      validate: (value): value is BlogState => this.isState(value),
      maxPlaintextBytes: 96 * 1024 * 1024
    })
    void this.store.initialize()
  }

  async getStatus() {
    const state = await this.store.read()
    return {
      storage: this.store.getStatus(),
      adapter: this.adapter.getStatus(),
      draftCount: state.drafts.length,
      publishedCount: state.drafts.filter((draft) => draft.status === 'published').length,
      resourceSyncError: this.resourceSyncError || undefined
    }
  }

  async findAll() {
    const state = await this.store.read()
    return [...state.drafts]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ content: _content, ...summary }) => summary)
  }

  async findOne(id: string) {
    const state = await this.store.read()
    return this.requireDraft(state, id)
  }

  async create(input: CreateBlogDraftInput) {
    const normalized = this.normalizeCreate(input)
    const now = Date.now()
    const id = randomUUID()
    const draft: BlogDraft = {
      id,
      title: normalized.title,
      slug: normalized.slug || this.createSlug(normalized.title, id),
      content: normalized.content,
      excerpt: normalized.excerpt,
      tags: normalized.tags,
      privacy: normalized.privacy,
      status: 'draft',
      sourceNoteId: normalized.sourceNoteId,
      createdAt: now,
      updatedAt: now
    }
    await this.store.update((state) => {
      if (state.drafts.length >= MAX_DRAFTS) throw new BadRequestException('Blog draft limit reached')
      this.assertUniqueSlug(state, draft.slug)
      state.drafts.push(draft)
    })
    await this.syncResourceIndex()
    return draft
  }

  async createFromXiaomiNote(noteId: string) {
    if (!/^\d{8,32}$/.test(noteId)) throw new BadRequestException('Invalid Xiaomi note id')
    const note = await this.xiaomiNotesService.findOne(noteId, true)
    return this.create({
      title: note.title,
      content: note.content || '',
      excerpt: note.preview,
      tags: [],
      privacy: 'private',
      sourceNoteId: note.id
    })
  }

  async update(id: string, input: UpdateBlogDraftInput) {
    const safeId = this.assertUuid(id)
    let updated!: BlogDraft
    await this.store.update((state) => {
      const index = state.drafts.findIndex((draft) => draft.id === safeId)
      if (index < 0) throw new NotFoundException('Blog draft was not found')
      const current = state.drafts[index]
      const patch = this.normalizeUpdate(input)
      if (patch.slug && patch.slug !== current.slug) this.assertUniqueSlug(state, patch.slug, safeId)
      updated = { ...current, ...patch, tags: patch.tags ?? current.tags, updatedAt: Date.now() }
      state.drafts[index] = updated
    })
    await this.syncResourceIndex()
    return updated
  }

  async remove(id: string) {
    const safeId = this.assertUuid(id)
    await this.store.update((state) => {
      const draft = this.requireDraft(state, safeId)
      if (draft.status === 'published') throw new ConflictException('Withdraw the published post before deleting its draft')
      state.drafts = state.drafts.filter((item) => item.id !== safeId)
    })
    await this.syncResourceIndex()
    return { id: safeId, removed: true }
  }

  async scan(id: string) {
    const draft = await this.findOne(id)
    return this.scanDraft(draft)
  }

  async preview(id: string) {
    const draft = await this.findOne(id)
    return { ...this.adapter.preview(draft), findings: this.scanDraft(draft) }
  }

  async publish(id: string, acceptedFindingIds: string[] = []) {
    const draft = await this.findOne(id)
    if (draft.privacy !== 'public') throw new BadRequestException('Only drafts classified as public can be published')
    const findings = this.scanDraft(draft)
    const accepted = new Set(Array.isArray(acceptedFindingIds) ? acceptedFindingIds : [])
    const blocking = findings.filter((finding) => finding.severity === 'high' && !accepted.has(finding.id))
    if (blocking.length) {
      throw new BadRequestException({
        message: 'Publishing is blocked by high-severity privacy findings',
        findingIds: blocking.map((finding) => finding.id)
      })
    }

    const publishTime = Date.now()
    const firstPublishedAt = draft.publishedAt || publishTime
    const result = await this.adapter.publish({ ...draft, publishedAt: firstPublishedAt, lastPublishedAt: publishTime })
    let published!: BlogDraft
    await this.store.update((state) => {
      const index = state.drafts.findIndex((item) => item.id === draft.id)
      if (index < 0) throw new NotFoundException('Blog draft was not found')
      published = {
        ...state.drafts[index],
        status: 'published',
        publishedAt: firstPublishedAt,
        lastPublishedAt: publishTime,
        publishedPath: result.relativePath,
        updatedAt: publishTime
      }
      state.drafts[index] = published
    })
    await this.syncResourceIndex()
    return { draft: published, findings, path: result.relativePath }
  }

  async withdraw(id: string) {
    const draft = await this.findOne(id)
    const result = await this.adapter.withdraw(draft)
    let withdrawn!: BlogDraft
    await this.store.update((state) => {
      const index = state.drafts.findIndex((item) => item.id === draft.id)
      if (index < 0) throw new NotFoundException('Blog draft was not found')
      withdrawn = { ...state.drafts[index], status: 'withdrawn', publishedPath: undefined, updatedAt: Date.now() }
      state.drafts[index] = withdrawn
    })
    await this.syncResourceIndex()
    return { draft: withdrawn, ...result }
  }

  private scanDraft(draft: BlogDraft) {
    return this.scanner.scan(`${draft.title}\n${draft.excerpt}\n${draft.content}`)
  }

  private async syncResourceIndex() {
    try {
      const state = await this.store.read()
      const resources: Resource[] = state.drafts.map((draft) => ({
        id: `blog:blog_post:${draft.id}`,
        type: 'blog_post',
        source: 'blog',
        sourceId: draft.id,
        title: draft.title,
        summary: draft.excerpt || compact(draft.content).slice(0, 300),
        content: draft.content,
        tags: draft.tags,
        privacy: draft.privacy,
        context: {
          projects: [],
          time: { startAt: draft.publishedAt || draft.createdAt, endAt: draft.updatedAt },
          locations: []
        },
        archived: draft.status === 'withdrawn',
        deleted: false,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        indexedAt: Date.now(),
        metadata: {
          slug: draft.slug,
          status: draft.status,
          sourceNoteId: draft.sourceNoteId,
          publishedAt: draft.publishedAt,
          lastPublishedAt: draft.lastPublishedAt,
          publishedPath: draft.publishedPath,
          publishDirty: draft.status === 'published' && Boolean(draft.lastPublishedAt && draft.updatedAt > draft.lastPublishedAt)
        }
      }))
      await this.resourcesService.replaceSourceResources('blog', 'blog_post', resources)
      this.resourceSyncError = ''
    } catch (error) {
      this.resourceSyncError = error instanceof Error ? error.message.slice(0, 240) : 'Blog Resource sync failed'
      console.warn('Blog Resource index sync failed', this.resourceSyncError)
    }
  }

  private normalizeCreate(input: CreateBlogDraftInput) {
    const title = this.cleanText(input.title, 300, 'Title')
    if (!title) throw new BadRequestException('Title is required')
    const content = typeof input.content === 'string' ? input.content.replace(/\r\n/g, '\n') : ''
    if (content.length > MAX_CONTENT) throw new BadRequestException(`Content cannot exceed ${MAX_CONTENT} characters`)
    const sourceNoteId = input.sourceNoteId
    if (sourceNoteId && !/^\d{8,32}$/.test(sourceNoteId)) throw new BadRequestException('Invalid source note id')
    return {
      title,
      slug: input.slug ? this.normalizeSlug(input.slug) : '',
      content,
      excerpt: this.cleanText(input.excerpt || '', 1_000, 'Excerpt'),
      tags: this.normalizeTags(input.tags || []),
      privacy: this.normalizePrivacy(input.privacy || 'private'),
      sourceNoteId
    }
  }

  private normalizeUpdate(input: UpdateBlogDraftInput) {
    const patch: UpdateBlogDraftInput = {}
    if ('title' in input) {
      const title = this.cleanText(input.title || '', 300, 'Title')
      if (!title) throw new BadRequestException('Title is required')
      patch.title = title
    }
    if ('slug' in input) patch.slug = this.normalizeSlug(input.slug || '')
    if ('content' in input) {
      if (typeof input.content !== 'string') throw new BadRequestException('Content must be text')
      if (input.content.length > MAX_CONTENT) throw new BadRequestException(`Content cannot exceed ${MAX_CONTENT} characters`)
      patch.content = input.content.replace(/\r\n/g, '\n')
    }
    if ('excerpt' in input) patch.excerpt = this.cleanText(input.excerpt || '', 1_000, 'Excerpt')
    if ('tags' in input) patch.tags = this.normalizeTags(input.tags || [])
    if ('privacy' in input) patch.privacy = this.normalizePrivacy(input.privacy || 'private')
    return patch
  }

  private isState(value: unknown): value is BlogState {
    const state = value as Partial<BlogState>
    return Boolean(state && Array.isArray(state.drafts) && state.drafts.length <= MAX_DRAFTS && state.drafts.every((draft) => this.isDraft(draft)))
  }

  private isDraft(value: unknown): value is BlogDraft {
    const draft = value as Partial<BlogDraft>
    return Boolean(draft && typeof draft.id === 'string' && typeof draft.title === 'string' && typeof draft.slug === 'string' && typeof draft.content === 'string' && draft.content.length <= MAX_CONTENT && typeof draft.excerpt === 'string' && Array.isArray(draft.tags) && typeof draft.privacy === 'string' && PRIVACY.has(draft.privacy as BlogPrivacy) && ['draft', 'published', 'withdrawn'].includes(String(draft.status)) && typeof draft.createdAt === 'number' && typeof draft.updatedAt === 'number')
  }

  private requireDraft(state: BlogState, id: string) {
    const safeId = this.assertUuid(id)
    const draft = state.drafts.find((item) => item.id === safeId)
    if (!draft) throw new NotFoundException('Blog draft was not found')
    return draft
  }

  private assertUniqueSlug(state: BlogState, slug: string, ignoreId?: string) {
    if (state.drafts.some((draft) => draft.id !== ignoreId && draft.slug === slug && draft.status !== 'withdrawn')) throw new ConflictException('Blog slug already exists')
  }

  private normalizeSlug(value: string) {
    const slug = value.trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) throw new BadRequestException('Slug must contain lowercase letters, numbers, and hyphens only')
    return slug
  }

  private createSlug(title: string, id: string) {
    const ascii = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
    return ascii || `post-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 8)}`
  }

  private normalizeTags(values: string[]) {
    if (!Array.isArray(values)) throw new BadRequestException('Tags must be an array')
    const tags = Array.from(new Set(values.map((value) => this.cleanText(value, 64, 'Tag')).filter(Boolean)))
    if (tags.length > MAX_TAGS) throw new BadRequestException(`At most ${MAX_TAGS} tags are allowed`)
    return tags
  }

  private normalizePrivacy(value: string) {
    if (!PRIVACY.has(value as BlogPrivacy)) throw new BadRequestException('Invalid privacy level')
    return value as BlogPrivacy
  }

  private cleanText(value: unknown, max: number, label: string) {
    if (typeof value !== 'string') throw new BadRequestException(`${label} must be text`)
    const text = value.trim().replace(/[\r\n]+/g, ' ')
    if (text.length > max) throw new BadRequestException(`${label} cannot exceed ${max} characters`)
    return text
  }

  private assertUuid(value: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('Invalid blog draft id')
    return value
  }
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}
