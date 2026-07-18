import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException
} from '@nestjs/common'
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getHistoryEncryptionSecret } from '../security/secrets'
import type {
  XiaomiNote,
  XiaomiNoteHistoryArchiveItem,
  XiaomiNoteHistoryEntry,
  XiaomiNoteHistoryReason,
  XiaomiNoteHistorySummary
} from './xiaomi-note.model'

const MAX_HISTORY_PER_NOTE = 60
const MAX_HISTORY_TOTAL = 1_000
const MAX_HISTORY_BYTES = 25 * 1024 * 1024
const MAX_HISTORY_CONTENT = 80_000
const MAX_LEGACY_FILE_BYTES = 64 * 1024 * 1024
const MIN_ENCRYPTION_SECRET_LENGTH = 16
const HISTORY_REASONS = new Set<XiaomiNoteHistoryReason>(['created', 'manual', 'before_update', 'before_delete', 'before_restore', 'restored'])
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8')
const KEY_CHECK_CONTEXT = 'terra-xiaomi-history-key-check-v1'
const ROW_KEY_CONTEXT = 'terra-xiaomi-history-row-encryption-v1'
const LOOKUP_KEY_CONTEXT = 'terra-xiaomi-history-lookup-index-v1'
const ROW_AAD_CONTEXT = 'terra-xiaomi-history-row-v1'

type HistoryFileFormat = 'new' | 'plain' | 'encrypted' | 'sqlite' | 'unreadable'
type EncryptedHistoryEnvelope = {
  format: 'terra-encrypted-history'
  version: 1
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  authTag: string
  ciphertext: string
}
type HistoryRow = {
  id: string
  note_key: Uint8Array
  captured_at: number
  payload: Uint8Array
  iv: Uint8Array
  auth_tag: Uint8Array
  payload_bytes: number
}
type ArchiveRow = HistoryRow & { version_count: number }
type LegacySource = {
  path: string
  entries: XiaomiNoteHistoryEntry[]
  format: 'plain' | 'encrypted'
}

@Injectable()
export class XiaomiNoteHistoryService implements OnModuleDestroy {
  private readonly dataFile = this.resolveDatabasePath()
  private readonly encryptionSecret = getHistoryEncryptionSecret()
  private readonly ready: Promise<void>
  private database?: DatabaseSync
  private encryptionKey?: Buffer
  private lookupKey?: Buffer
  private loadError = ''
  private fileFormat: HistoryFileFormat = 'new'
  private migrationPending = false
  private migratedFrom?: 'plain' | 'encrypted'
  private entryCount = 0

  constructor() {
    this.ready = Promise.resolve().then(() => this.initialize()).catch((error) => {
      this.fileFormat = 'unreadable'
      this.loadError = this.safeError(error)
    })
  }

  async onModuleDestroy() {
    await this.ready
    this.database?.close()
    this.database = undefined
    this.encryptionKey?.fill(0)
    this.encryptionKey = undefined
    this.lookupKey?.fill(0)
    this.lookupKey = undefined
  }

  getStorageStatus() {
    const encryptionConfigured = this.hasEncryptionSecret()
    return {
      available: !this.loadError,
      encryptedAtRest: this.fileFormat === 'sqlite' && encryptionConfigured && !this.loadError,
      encryptionConfigured,
      migrationPending: this.migrationPending,
      format: this.fileFormat,
      backend: 'sqlite',
      rowEncryption: 'aes-256-gcm',
      lookupIndex: 'hmac-sha256',
      entryCount: this.entryCount,
      migratedFrom: this.migratedFrom,
      message: this.loadError || 'Terra 历史使用 SQLite 查询索引与 AES-256-GCM 行级加密'
    }
  }

  async ensureAvailable() {
    await this.ensureReady()
  }

  async findAll(noteId: string): Promise<XiaomiNoteHistorySummary[]> {
    await this.ensureReady()
    const rows = this.db().prepare(`
      SELECT id, note_key, captured_at, payload, iv, auth_tag, payload_bytes
      FROM history_entries
      WHERE note_key = ?
      ORDER BY captured_at DESC, id DESC
    `).all(this.noteKey(noteId)) as unknown as HistoryRow[]
    return rows.map((row) => {
      const { content: _content, ...summary } = this.decryptRow(row)
      return summary
    })
  }

  async findOne(noteId: string, historyId: string) {
    await this.ensureReady()
    this.assertHistoryId(historyId)
    const row = this.db().prepare(`
      SELECT id, note_key, captured_at, payload, iv, auth_tag, payload_bytes
      FROM history_entries
      WHERE id = ? AND note_key = ?
    `).get(historyId, this.noteKey(noteId)) as unknown as HistoryRow | undefined
    if (!row) throw new NotFoundException('历史版本不存在或已被清理')
    return this.decryptRow(row)
  }

  async removeOne(noteId: string, historyId: string) {
    await this.ensureReady()
    this.assertHistoryId(historyId)
    const result = this.db().prepare('DELETE FROM history_entries WHERE id = ? AND note_key = ?').run(historyId, this.noteKey(noteId))
    if (Number(result.changes) === 0) throw new NotFoundException('历史版本不存在或已被清理')
    this.refreshEntryCount()
    return { noteId, historyId, removed: true }
  }

  async removeAll(noteId: string) {
    await this.ensureReady()
    const result = this.db().prepare('DELETE FROM history_entries WHERE note_key = ?').run(this.noteKey(noteId))
    const removed = Number(result.changes)
    this.refreshEntryCount()
    return { noteId, removed }
  }

  async findByHistoryId(historyId: string) {
    await this.ensureReady()
    this.assertHistoryId(historyId)
    const row = this.db().prepare(`
      SELECT id, note_key, captured_at, payload, iv, auth_tag, payload_bytes
      FROM history_entries
      WHERE id = ?
    `).get(historyId) as unknown as HistoryRow | undefined
    if (!row) throw new NotFoundException('History version was not found')
    return this.decryptRow(row)
  }

  async findArchive(): Promise<XiaomiNoteHistoryArchiveItem[]> {
    await this.ensureReady()
    const rows = this.db().prepare(`
      SELECT id, note_key, captured_at, payload, iv, auth_tag, payload_bytes, version_count
      FROM (
        SELECT id, note_key, captured_at, payload, iv, auth_tag, payload_bytes,
          COUNT(*) OVER (PARTITION BY note_key) AS version_count,
          ROW_NUMBER() OVER (PARTITION BY note_key ORDER BY captured_at DESC, id DESC) AS row_number
        FROM history_entries
      )
      WHERE row_number = 1
      ORDER BY captured_at DESC, id DESC
    `).all() as unknown as ArchiveRow[]
    return rows.map((row) => {
      const latest = this.decryptRow(row)
      return {
        noteId: latest.noteId,
        title: latest.title,
        preview: latest.preview,
        lastCapturedAt: latest.capturedAt,
        versionCount: Number(row.version_count),
        lastReason: latest.reason,
        deletedCandidate: latest.reason === 'before_delete'
      }
    })
  }

  async capture(note: XiaomiNote, reason: XiaomiNoteHistoryReason) {
    await this.ensureReady()
    if (!HISTORY_REASONS.has(reason)) throw new BadRequestException('历史快照原因无效')
    const content = typeof note.content === 'string' ? note.content : ''
    if (content.length > MAX_HISTORY_CONTENT) throw new BadRequestException('笔记正文过长，无法创建历史快照')
    const noteKey = this.noteKey(note.id)
    const latestRow = this.db().prepare(`
      SELECT id, note_key, captured_at, payload, iv, auth_tag, payload_bytes
      FROM history_entries
      WHERE note_key = ?
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `).get(noteKey) as unknown as HistoryRow | undefined
    let latest: XiaomiNoteHistoryEntry | undefined
    if (latestRow) {
      latest = this.decryptRow(latestRow)
      if (latest.title === note.title && latest.content === content && reason !== 'manual') return latest
    }

    const capturedAt = Math.max(Date.now(), (latest?.capturedAt || 0) + 1)
    const entry: XiaomiNoteHistoryEntry = {
      id: `history-${capturedAt}-${randomUUID().slice(0, 8)}`,
      noteId: note.id,
      title: note.title,
      content,
      preview: this.compact(content).slice(0, 180),
      capturedAt,
      sourceModifyDate: note.modifyDate,
      reason
    }
    this.assertEntry(entry)
    this.transaction(() => {
      this.insertEntry(entry)
      this.trim()
    })
    this.refreshEntryCount()
    return structuredClone(entry)
  }

  private initialize() {
    if (!this.hasEncryptionSecret()) {
      this.migrationPending = this.hasPotentialLegacySource()
      throw new Error('Terra SQLite 历史需要 TERRA_HISTORY_ENCRYPTION_KEY 或系统密钥库中的历史密钥')
    }
    mkdirSync(dirname(this.dataFile), { recursive: true, mode: 0o700 })

    let legacy: LegacySource | undefined
    if (existsSync(this.dataFile) && !this.isSqliteFile(this.dataFile)) {
      legacy = this.readLegacySource(this.dataFile)
      const archivePath = `${this.dataFile}.legacy-json-${Date.now()}`
      renameSync(this.dataFile, archivePath)
      legacy = { ...legacy, path: archivePath }
    }

    if (!existsSync(this.dataFile) && !legacy) legacy = this.findLegacySource()

    const existingDatabase = existsSync(this.dataFile)
    if (existingDatabase) {
      const keys = this.verifyExistingDatabaseKey()
      this.encryptionKey = keys.encryptionKey
      this.lookupKey = keys.lookupKey
    }
    this.database = new DatabaseSync(this.dataFile)
    this.configureDatabase(this.database)
    if (!existingDatabase) this.initializeKeyMaterial()
    chmodSync(this.dataFile, 0o600)

    this.entryCount = this.countEntries()
    this.loadMigrationMetadata()
    if (this.entryCount === 0) {
      legacy ||= this.findLegacySource()
      if (legacy) this.importLegacy(legacy)
    }
    this.entryCount = this.countEntries()
    this.fileFormat = 'sqlite'
    this.migrationPending = false
  }

  private configureDatabase(database: DatabaseSync) {
    database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA temp_store = MEMORY;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS history_meta (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS history_entries (
        id TEXT PRIMARY KEY,
        note_key BLOB NOT NULL,
        captured_at INTEGER NOT NULL,
        payload BLOB NOT NULL,
        iv BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        payload_bytes INTEGER NOT NULL CHECK(payload_bytes >= 0)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS history_note_captured_idx
        ON history_entries(note_key, captured_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS history_captured_idx
        ON history_entries(captured_at DESC, id DESC);
    `)
  }

  private initializeKeyMaterial() {
    const salt = randomBytes(16)
    const keys = this.deriveRowKeys(salt)
    this.transaction(() => {
      const insert = this.db().prepare('INSERT INTO history_meta(key, value) VALUES (?, ?)')
      insert.run('schema_version', Buffer.from('1', 'utf8'))
      insert.run('kdf_salt', salt)
      insert.run('key_check', keys.keyCheck)
    })
    this.encryptionKey = keys.encryptionKey
    this.lookupKey = keys.lookupKey
  }

  private verifyExistingDatabaseKey() {
    const database = new DatabaseSync(this.dataFile, { readOnly: true })
    try {
      const readMeta = database.prepare('SELECT value FROM history_meta WHERE key = ?')
      const version = this.metaBuffer(readMeta.get('schema_version'))
      const salt = this.metaBuffer(readMeta.get('kdf_salt'))
      const expected = this.metaBuffer(readMeta.get('key_check'))
      if (version.toString('utf8') !== '1' || salt.length !== 16 || expected.length !== 32) throw new Error('SQLite history metadata is invalid')
      const keys = this.deriveRowKeys(salt)
      if (!timingSafeEqual(keys.keyCheck, expected)) {
        keys.encryptionKey.fill(0)
        keys.lookupKey.fill(0)
        throw new Error('SQLite history decryption failed; check the history key. Original database was preserved')
      }
      return { encryptionKey: keys.encryptionKey, lookupKey: keys.lookupKey }
    } finally {
      database.close()
    }
  }

  private importLegacy(source: LegacySource) {
    const deduplicated = Array.from(new Map(source.entries.map((entry) => [entry.id, entry])).values())
    this.transaction(() => {
      for (const entry of deduplicated) this.insertEntry(entry)
      this.trim()
      const insertMeta = this.db().prepare('INSERT OR REPLACE INTO history_meta(key, value) VALUES (?, ?)')
      insertMeta.run('legacy_migrated_at', Buffer.from(String(Date.now()), 'utf8'))
      insertMeta.run('legacy_format', Buffer.from(source.format, 'utf8'))
    })
    this.migratedFrom = source.format
    this.entryCount = this.countEntries()
  }

  private loadMigrationMetadata() {
    const row = this.db().prepare("SELECT value FROM history_meta WHERE key = 'legacy_format'").get() as { value?: Uint8Array } | undefined
    const value = row?.value ? Buffer.from(row.value).toString('utf8') : ''
    if (value === 'plain' || value === 'encrypted') this.migratedFrom = value
  }

  private deriveRowKeys(salt: Buffer) {
    const master = scryptSync(this.encryptionSecret, salt, 32)
    const keyCheck = createHmac('sha256', master).update(KEY_CHECK_CONTEXT).digest()
    const encryptionKey = createHmac('sha256', master).update(ROW_KEY_CONTEXT).digest()
    const lookupKey = createHmac('sha256', master).update(LOOKUP_KEY_CONTEXT).digest()
    master.fill(0)
    return { keyCheck, encryptionKey, lookupKey }
  }

  private insertEntry(entry: XiaomiNoteHistoryEntry) {
    this.assertEntry(entry)
    const noteKey = this.noteKey(entry.noteId)
    const encrypted = this.encryptEntry(entry, noteKey)
    this.db().prepare(`
      INSERT INTO history_entries(id, note_key, captured_at, payload, iv, auth_tag, payload_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, noteKey, entry.capturedAt, encrypted.payload, encrypted.iv, encrypted.authTag, encrypted.payload.length)
  }

  private encryptEntry(entry: XiaomiNoteHistoryEntry, noteKey: Buffer) {
    const plaintext = Buffer.from(JSON.stringify(entry), 'utf8')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    cipher.setAAD(this.rowAad(entry.id, noteKey, entry.capturedAt))
    const payload = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return { payload, iv, authTag: cipher.getAuthTag() }
  }

  private decryptRow(row: HistoryRow) {
    try {
      const noteKey = Buffer.from(row.note_key)
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(row.iv))
      decipher.setAAD(this.rowAad(row.id, noteKey, Number(row.captured_at)))
      decipher.setAuthTag(Buffer.from(row.auth_tag))
      const plaintext = Buffer.concat([decipher.update(Buffer.from(row.payload)), decipher.final()]).toString('utf8')
      const entry = JSON.parse(plaintext) as unknown
      this.assertEntry(entry)
      if (entry.id !== row.id || entry.capturedAt !== Number(row.captured_at)) throw new Error('History row metadata mismatch')
      const expectedNoteKey = this.noteKey(entry.noteId)
      if (expectedNoteKey.length !== noteKey.length || !timingSafeEqual(expectedNoteKey, noteKey)) throw new Error('History row lookup key mismatch')
      return structuredClone(entry)
    } catch {
      throw new ServiceUnavailableException('历史版本解密或完整性校验失败；数据库未被修改')
    }
  }

  private trim() {
    this.db().exec(`
      DELETE FROM history_entries
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY note_key ORDER BY captured_at DESC, id DESC) AS row_number
          FROM history_entries
        ) WHERE row_number > ${MAX_HISTORY_PER_NOTE}
      );
      DELETE FROM history_entries
      WHERE id IN (
        SELECT id FROM history_entries
        ORDER BY captured_at DESC, id DESC
        LIMIT -1 OFFSET ${MAX_HISTORY_TOTAL}
      );
    `)
    const rows = this.db().prepare('SELECT id, payload_bytes FROM history_entries ORDER BY captured_at DESC, id DESC').all() as Array<{ id: string; payload_bytes: number }>
    let retainedBytes = 0
    const remove = this.db().prepare('DELETE FROM history_entries WHERE id = ?')
    rows.forEach((row, index) => {
      const bytes = Number(row.payload_bytes) + 160
      if (index > 0 && retainedBytes + bytes > MAX_HISTORY_BYTES) remove.run(row.id)
      else retainedBytes += bytes
    })
  }

  private transaction<T>(work: () => T) {
    const database = this.db()
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  private findLegacySource() {
    for (const candidate of this.legacyCandidatePaths()) {
      if (candidate === this.dataFile && this.isSqliteFile(candidate)) continue
      const source = this.tryReadLegacySource(candidate)
      if (source) return source
    }
    return undefined
  }

  private legacyCandidatePaths() {
    const values = new Set<string>()
    values.add(this.dataFile)
    const configuredLegacy = process.env.TERRA_XIAOMI_HISTORY_LEGACY_FILE || ''
    const oldConfigured = process.env.TERRA_XIAOMI_HISTORY_FILE || ''
    if (configuredLegacy.trim()) values.add(resolve(configuredLegacy.trim()))
    if (process.env.TERRA_XIAOMI_HISTORY_DB && oldConfigured.trim()) values.add(resolve(oldConfigured.trim()))
    values.add(resolve(process.cwd(), 'data', 'xiaomi-note-history.json'))
    if (existsSync(dirname(this.dataFile))) {
      const prefix = `${basename(this.dataFile)}.legacy-json-`
      const migrated = readdirSync(dirname(this.dataFile))
        .filter((name) => name.startsWith(prefix))
        .sort()
        .reverse()
      for (const name of migrated) values.add(join(dirname(this.dataFile), name))
    }
    return [...values]
  }

  private tryReadLegacySource(path: string) {
    for (const candidate of [path, `${path}.bak`]) {
      if (!existsSync(candidate) || this.isSqliteFile(candidate)) continue
      return this.readLegacySource(candidate)
    }
    return undefined
  }

  private readLegacySource(path: string): LegacySource {
    const info = statSync(path)
    if (!info.isFile() || info.size > MAX_LEGACY_FILE_BYTES) throw new Error('Legacy history source is unsafe or too large')
    const parsed = this.deserializeLegacy(readFileSync(path, 'utf8'))
    if (parsed.entries.length > 10_000 || !parsed.entries.every((entry) => this.isEntry(entry))) {
      throw new Error('Legacy history contains invalid entries; source file was preserved')
    }
    if (parsed.format === 'plain') this.encryptLegacySource(path, parsed.entries)
    return { path, entries: parsed.entries, format: parsed.format }
  }

  private encryptLegacySource(path: string, entries: XiaomiNoteHistoryEntry[]) {
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = scryptSync(this.encryptionSecret, salt, 32)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries), 'utf8'), cipher.final()])
    key.fill(0)
    const envelope: EncryptedHistoryEnvelope = {
      format: 'terra-encrypted-history',
      version: 1,
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
    writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    chmodSync(path, 0o600)
  }

  private deserializeLegacy(raw: string): { entries: XiaomiNoteHistoryEntry[]; format: 'plain' | 'encrypted' } {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    } catch {
      throw new Error('Legacy history is not valid JSON; source file was preserved')
    }
    if (Array.isArray(parsed)) return { entries: parsed as XiaomiNoteHistoryEntry[], format: 'plain' }
    if (!this.isEncryptedEnvelope(parsed)) throw new Error('Legacy history format is not recognized; source file was preserved')
    let key: Buffer | undefined
    try {
      key = scryptSync(this.encryptionSecret, Buffer.from(parsed.salt, 'base64'), 32)
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'))
      const plaintext = Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext, 'base64')), decipher.final()]).toString('utf8')
      const entries = JSON.parse(plaintext) as unknown
      if (!Array.isArray(entries)) throw new Error('Decrypted history is not an array')
      return { entries: entries as XiaomiNoteHistoryEntry[], format: 'encrypted' }
    } catch {
      throw new Error('Legacy history decryption failed; check the history key. Source file was preserved')
    } finally {
      key?.fill(0)
    }
  }

  private hasPotentialLegacySource() {
    return this.legacyCandidatePaths().some((path) => [path, `${path}.bak`].some((candidate) => existsSync(candidate) && !this.isSqliteFile(candidate)))
  }

  private resolveDatabasePath() {
    const configured = process.env.TERRA_XIAOMI_HISTORY_DB || process.env.TERRA_XIAOMI_HISTORY_FILE
    return resolve(configured || join(process.cwd(), 'data', 'xiaomi-note-history.sqlite'))
  }

  private isSqliteFile(path: string) {
    if (!existsSync(path)) return false
    const info = statSync(path)
    if (!info.isFile() || info.size < SQLITE_HEADER.length) return false
    const descriptor = openSync(path, 'r')
    try {
      const header = Buffer.alloc(SQLITE_HEADER.length)
      return readSync(descriptor, header, 0, header.length, 0) === header.length && header.equals(SQLITE_HEADER)
    } finally {
      closeSync(descriptor)
    }
  }

  private noteKey(noteId: string) {
    const value = typeof noteId === 'string' ? noteId.trim() : ''
    if (!/^\d{8,32}$/.test(value)) throw new BadRequestException('笔记 ID 格式不正确')
    return createHmac('sha256', this.lookupIndexKey()).update(`note:${value}`, 'utf8').digest()
  }

  private rowAad(id: string, noteKey: Buffer, capturedAt: number) {
    return Buffer.concat([
      Buffer.from(`${ROW_AAD_CONTEXT}\0${id}\0${capturedAt}\0`, 'utf8'),
      noteKey
    ])
  }

  private metaBuffer(row: unknown) {
    const value = (row as { value?: Uint8Array } | undefined)?.value
    if (!value) throw new Error('SQLite history metadata is missing')
    return Buffer.from(value)
  }

  private countEntries() {
    const row = this.db().prepare('SELECT COUNT(*) AS count FROM history_entries').get() as { count: number }
    return Number(row.count)
  }

  private refreshEntryCount() {
    this.entryCount = this.countEntries()
  }

  private db() {
    if (!this.database) throw new ServiceUnavailableException('SQLite history database is unavailable')
    return this.database
  }

  private key() {
    if (!this.encryptionKey) throw new ServiceUnavailableException('SQLite history encryption key is unavailable')
    return this.encryptionKey
  }

  private lookupIndexKey() {
    if (!this.lookupKey) throw new ServiceUnavailableException('SQLite history lookup key is unavailable')
    return this.lookupKey
  }

  private async ensureReady() {
    await this.ready
    if (this.loadError) throw new ServiceUnavailableException(this.loadError)
  }

  private assertEntry(value: unknown): asserts value is XiaomiNoteHistoryEntry {
    if (!this.isEntry(value)) throw new BadRequestException('历史版本数据格式无效')
  }

  private isEntry(value: unknown): value is XiaomiNoteHistoryEntry {
    const item = value as Partial<XiaomiNoteHistoryEntry>
    return Boolean(
      item && this.isHistoryId(item.id) && typeof item.noteId === 'string' && /^\d{8,32}$/.test(item.noteId) &&
      typeof item.title === 'string' && item.title.length <= 200 &&
      typeof item.content === 'string' && item.content.length <= MAX_HISTORY_CONTENT &&
      typeof item.preview === 'string' && item.preview.length <= 180 &&
      Number.isSafeInteger(item.capturedAt) && item.capturedAt! >= 0 &&
      Number.isSafeInteger(item.sourceModifyDate) && item.sourceModifyDate! >= 0 &&
      typeof item.reason === 'string' && HISTORY_REASONS.has(item.reason as XiaomiNoteHistoryReason)
    )
  }

  private isEncryptedEnvelope(value: unknown): value is EncryptedHistoryEnvelope {
    const item = value as Partial<EncryptedHistoryEnvelope>
    return Boolean(
      item && item.format === 'terra-encrypted-history' && item.version === 1 &&
      item.algorithm === 'aes-256-gcm' && item.kdf === 'scrypt' &&
      typeof item.salt === 'string' && typeof item.iv === 'string' &&
      typeof item.authTag === 'string' && typeof item.ciphertext === 'string'
    )
  }

  private hasEncryptionSecret() {
    return this.encryptionSecret.length >= MIN_ENCRYPTION_SECRET_LENGTH
  }

  private assertHistoryId(id: string) {
    if (!this.isHistoryId(id)) throw new BadRequestException('历史版本 ID 格式不正确')
  }

  private isHistoryId(value: unknown): value is string {
    return typeof value === 'string' && /^history-\d{10,16}-[a-f0-9]{8}$/.test(value)
  }

  private compact(value: string) {
    return value.replace(/\s+/g, ' ').trim()
  }

  private safeError(error: unknown) {
    const message = error instanceof Error ? error.message : '历史存储初始化失败'
    return message.replace(/[\r\n]/g, ' ').slice(0, 240)
  }
}
