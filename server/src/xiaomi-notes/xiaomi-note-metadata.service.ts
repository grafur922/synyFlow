import { BadRequestException, Injectable } from '@nestjs/common'
import { join } from 'node:path'
import { EncryptedJsonStore } from '../storage/encrypted-json.store'
import { getDataEncryptionSecret } from '../security/secrets'
import type {
  NotePrivacyLevel,
  UpdateXiaomiNoteMetadataInput,
  XiaomiNoteMetadata
} from './xiaomi-note-metadata.model'

const MAX_METADATA_ENTRIES = 50_000
const MAX_TAGS = 20
const MAX_TAG_LENGTH = 32
const PRIVACY_LEVELS = new Set<NotePrivacyLevel>(['public', 'private', 'secret'])

@Injectable()
export class XiaomiNoteMetadataService {
  private readonly store: EncryptedJsonStore<XiaomiNoteMetadata[]>

  constructor() {
    const encryptionSecret = getDataEncryptionSecret()
    this.store = new EncryptedJsonStore<XiaomiNoteMetadata[]>({
      filePath: process.env.TERRA_XIAOMI_METADATA_FILE || join(process.cwd(), 'data', 'xiaomi-note-metadata.json'),
      encryptionSecret,
      encryptedFormat: 'terra-xiaomi-note-metadata',
      defaultValue: () => [],
      validate: (value): value is XiaomiNoteMetadata[] => Array.isArray(value) && value.length <= MAX_METADATA_ENTRIES && value.every((item) => this.isMetadata(item)),
      maxPlaintextBytes: 8 * 1024 * 1024
    })
    void this.store.initialize()
  }

  getStatus() {
    return this.store.getStatus()
  }

  findAll() {
    return this.store.read()
  }

  async findOne(noteId: string) {
    const safeId = this.assertNoteId(noteId)
    const entries = await this.store.read()
    return entries.find((entry) => entry.noteId === safeId) || this.createDefault(safeId)
  }

  async update(noteId: string, input: UpdateXiaomiNoteMetadataInput) {
    const safeId = this.assertNoteId(noteId)
    const patch = this.normalizePatch(input)
    let updated!: XiaomiNoteMetadata

    await this.store.update((entries) => {
      const index = entries.findIndex((entry) => entry.noteId === safeId)
      const current = index >= 0 ? entries[index] : this.createDefault(safeId)
      updated = {
        ...current,
        ...patch,
        tags: patch.tags ?? current.tags,
        updatedAt: Date.now()
      }
      if (index >= 0) entries[index] = updated
      else {
        if (entries.length >= MAX_METADATA_ENTRIES) throw new BadRequestException('Note metadata limit reached')
        entries.push(updated)
      }
    })

    return { ...updated, tags: [...updated.tags] }
  }

  async remove(noteId: string) {
    const safeId = this.assertNoteId(noteId)
    let removed = false
    await this.store.update((entries) => {
      const next = entries.filter((entry) => entry.noteId !== safeId)
      removed = next.length !== entries.length
      return next
    })
    return { noteId: safeId, removed }
  }

  private createDefault(noteId: string): XiaomiNoteMetadata {
    const now = Date.now()
    return {
      noteId,
      favorite: false,
      archived: false,
      tags: [],
      privacy: 'private',
      createdAt: now,
      updatedAt: now
    }
  }

  private normalizePatch(input: UpdateXiaomiNoteMetadataInput) {
    const patch: UpdateXiaomiNoteMetadataInput = {}
    if ('favorite' in input) patch.favorite = Boolean(input.favorite)
    if ('archived' in input) patch.archived = Boolean(input.archived)
    if ('privacy' in input) {
      if (!input.privacy || !PRIVACY_LEVELS.has(input.privacy)) throw new BadRequestException('Invalid privacy level')
      patch.privacy = input.privacy
    }
    if ('tags' in input) {
      if (!Array.isArray(input.tags)) throw new BadRequestException('Tags must be an array')
      const tags = Array.from(new Set(input.tags.map((tag) => this.cleanTag(tag)).filter(Boolean)))
      if (tags.length > MAX_TAGS) throw new BadRequestException(`A note can have at most ${MAX_TAGS} tags`)
      patch.tags = tags
    }
    return patch
  }

  private cleanTag(value: unknown) {
    if (typeof value !== 'string') throw new BadRequestException('Tag must be text')
    const tag = value.trim().replace(/\s+/g, ' ')
    if (!tag) return ''
    if (tag.length > MAX_TAG_LENGTH) throw new BadRequestException(`Tag cannot exceed ${MAX_TAG_LENGTH} characters`)
    if (/\p{Cc}/u.test(tag)) throw new BadRequestException('Tag contains control characters')
    return tag
  }

  private isMetadata(value: unknown): value is XiaomiNoteMetadata {
    const item = value as Partial<XiaomiNoteMetadata>
    return Boolean(
      item &&
      typeof item.noteId === 'string' && /^\d{8,32}$/.test(item.noteId) &&
      typeof item.favorite === 'boolean' &&
      typeof item.archived === 'boolean' &&
      Array.isArray(item.tags) && item.tags.length <= MAX_TAGS && item.tags.every((tag) => typeof tag === 'string' && tag.length <= MAX_TAG_LENGTH) &&
      typeof item.privacy === 'string' && PRIVACY_LEVELS.has(item.privacy as NotePrivacyLevel) &&
      typeof item.createdAt === 'number' &&
      typeof item.updatedAt === 'number'
    )
  }

  private assertNoteId(noteId: string) {
    const value = typeof noteId === 'string' ? noteId.trim() : ''
    if (!/^\d{8,32}$/.test(value)) throw new BadRequestException('Invalid Xiaomi note id')
    return value
  }
}
