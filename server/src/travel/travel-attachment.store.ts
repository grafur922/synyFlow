import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getDataEncryptionSecret } from '../security/secrets'

const MIN_SECRET_LENGTH = 16
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_ATTACHMENTS = 20_000
const KEY_CHECK_CONTEXT = 'terra-travel-attachments-key-check-v1'
const ROW_KEY_CONTEXT = 'terra-travel-attachments-row-key-v1'
const ROW_AAD_CONTEXT = 'terra-travel-attachment-row-v1'

type AttachmentRow = {
  id: string
  created_at: number
  plaintext_bytes: number
  ciphertext: Uint8Array
  iv: Uint8Array
  auth_tag: Uint8Array
}

@Injectable()
export class TravelAttachmentStore implements OnModuleDestroy {
  private readonly databasePath = resolve(process.env.TERRA_TRAVEL_ATTACHMENTS_DB || join(process.cwd(), 'data', 'travel-attachments.sqlite'))
  private readonly secret = getDataEncryptionSecret()
  private readonly ready: Promise<void>
  private database?: DatabaseSync
  private rowKey?: Buffer
  private loadError = ''

  constructor() {
    this.ready = Promise.resolve().then(() => this.initialize()).catch((cause) => {
      this.loadError = this.safeError(cause)
    })
  }

  async onModuleDestroy() {
    await this.ready
    this.database?.close()
    this.database = undefined
    this.rowKey?.fill(0)
    this.rowKey = undefined
  }

  async getStatus() {
    await this.ready
    if (this.loadError || !this.database) {
      return {
        available: false,
        encryptedAtRest: false,
        backend: 'sqlite',
        count: 0,
        bytes: 0,
        message: this.loadError || 'Travel attachment database is unavailable'
      }
    }
    const totals = this.database.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(plaintext_bytes), 0) AS bytes FROM travel_attachments').get() as { count: number; bytes: number }
    return {
      available: true,
      encryptedAtRest: true,
      backend: 'sqlite',
      count: Number(totals.count),
      bytes: Number(totals.bytes),
      message: 'Travel attachment bodies use SQLite rows with AES-256-GCM encryption'
    }
  }

  async ensureAvailable() {
    await this.ensureReady()
  }

  async put(id: string, content: Buffer, createdAt: number) {
    await this.ensureReady()
    this.assertId(id)
    this.assertContent(content)
    this.assertTimestamp(createdAt)
    const encrypted = this.encrypt(id, content, createdAt)
    this.transaction(() => {
      const totals = this.db().prepare('SELECT COUNT(*) AS count, COALESCE(SUM(plaintext_bytes), 0) AS bytes FROM travel_attachments').get() as { count: number; bytes: number }
      if (Number(totals.count) >= MAX_ATTACHMENTS) throw new ServiceUnavailableException('Travel attachment count limit reached')
      if (Number(totals.bytes) + content.length > MAX_TOTAL_BYTES) throw new ServiceUnavailableException('Travel attachment storage budget reached')
      this.db().prepare(`
        INSERT INTO travel_attachments(id, created_at, plaintext_bytes, ciphertext, iv, auth_tag)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, createdAt, content.length, encrypted.ciphertext, encrypted.iv, encrypted.authTag)
    })
  }

  async get(id: string) {
    await this.ensureReady()
    this.assertId(id)
    const row = this.db().prepare(`
      SELECT id, created_at, plaintext_bytes, ciphertext, iv, auth_tag
      FROM travel_attachments
      WHERE id = ?
    `).get(id) as unknown as AttachmentRow | undefined
    if (!row) throw new ServiceUnavailableException('Travel attachment body is missing')
    return { content: this.decrypt(row), createdAt: Number(row.created_at) }
  }

  async remove(id: string) {
    await this.ensureReady()
    this.assertId(id)
    return Number(this.db().prepare('DELETE FROM travel_attachments WHERE id = ?').run(id).changes) > 0
  }

  async removeMany(ids: string[]) {
    await this.ensureReady()
    const unique = Array.from(new Set(ids))
    unique.forEach((id) => this.assertId(id))
    let removed = 0
    this.transaction(() => {
      const statement = this.db().prepare('DELETE FROM travel_attachments WHERE id = ?')
      for (const id of unique) removed += Number(statement.run(id).changes)
    })
    return removed
  }

  async removeUnreferenced(referencedIds: Set<string>) {
    await this.ensureReady()
    const rows = this.db().prepare('SELECT id FROM travel_attachments').all() as Array<{ id: string }>
    const orphanIds = rows.map((row) => row.id).filter((id) => !referencedIds.has(id))
    if (orphanIds.length) await this.removeMany(orphanIds)
    return orphanIds.length
  }

  async listIds() {
    await this.ensureReady()
    return (this.db().prepare('SELECT id FROM travel_attachments').all() as Array<{ id: string }>).map((row) => row.id)
  }

  private initialize() {
    if (this.secret.length < MIN_SECRET_LENGTH) throw new Error('Travel attachments require TERRA_DATA_ENCRYPTION_KEY or a system data key')
    if (existsSync(this.databasePath)) {
      const info = statSync(this.databasePath)
      if (!info.isFile()) throw new Error('Travel attachment database path is not a regular file')
      const verified = this.verifyExistingDatabaseKey()
      this.rowKey = verified
    }

    mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 })
    const existing = existsSync(this.databasePath)
    this.database = new DatabaseSync(this.databasePath)
    this.configureDatabase(this.database)
    if (!existing) this.initializeKeyMaterial()
    chmodSync(this.databasePath, 0o600)
  }

  private configureDatabase(database: DatabaseSync) {
    database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA temp_store = MEMORY;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS travel_attachment_meta (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS travel_attachments (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL CHECK(created_at >= 0),
        plaintext_bytes INTEGER NOT NULL CHECK(plaintext_bytes > 0),
        ciphertext BLOB NOT NULL,
        iv BLOB NOT NULL,
        auth_tag BLOB NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS travel_attachments_created_idx
        ON travel_attachments(created_at DESC, id DESC);
    `)
  }

  private initializeKeyMaterial() {
    const salt = randomBytes(16)
    const derived = this.deriveKeys(salt)
    this.transaction(() => {
      const insert = this.db().prepare('INSERT INTO travel_attachment_meta(key, value) VALUES (?, ?)')
      insert.run('schema_version', Buffer.from('1', 'utf8'))
      insert.run('kdf_salt', salt)
      insert.run('key_check', derived.keyCheck)
    })
    this.rowKey = derived.rowKey
  }

  private verifyExistingDatabaseKey() {
    const database = new DatabaseSync(this.databasePath, { readOnly: true })
    try {
      const read = database.prepare('SELECT value FROM travel_attachment_meta WHERE key = ?')
      const version = this.metaBuffer(read.get('schema_version'))
      const salt = this.metaBuffer(read.get('kdf_salt'))
      const expected = this.metaBuffer(read.get('key_check'))
      if (version.toString('utf8') !== '1' || salt.length !== 16 || expected.length !== 32) throw new Error('Travel attachment database metadata is invalid')
      const derived = this.deriveKeys(salt)
      if (!timingSafeEqual(derived.keyCheck, expected)) {
        derived.rowKey.fill(0)
        throw new Error('Travel attachment database key is incorrect; the original database was preserved')
      }
      return derived.rowKey
    } finally {
      database.close()
    }
  }

  private deriveKeys(salt: Buffer) {
    const master = scryptSync(this.secret, salt, 32)
    const keyCheck = createHmac('sha256', master).update(KEY_CHECK_CONTEXT).digest()
    const rowKey = createHmac('sha256', master).update(ROW_KEY_CONTEXT).digest()
    master.fill(0)
    return { keyCheck, rowKey }
  }

  private encrypt(id: string, content: Buffer, createdAt: number) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    cipher.setAAD(this.aad(id, content.length, createdAt))
    const ciphertext = Buffer.concat([cipher.update(content), cipher.final()])
    return { ciphertext, iv, authTag: cipher.getAuthTag() }
  }

  private decrypt(row: AttachmentRow) {
    try {
      const size = Number(row.plaintext_bytes)
      const createdAt = Number(row.created_at)
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES || !Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error('Invalid row metadata')
      const iv = Buffer.from(row.iv)
      const authTag = Buffer.from(row.auth_tag)
      if (iv.length !== 12 || authTag.length !== 16) throw new Error('Invalid encryption metadata')
      const decipher = createDecipheriv('aes-256-gcm', this.key(), iv)
      decipher.setAAD(this.aad(row.id, size, createdAt))
      decipher.setAuthTag(authTag)
      const content = Buffer.concat([decipher.update(Buffer.from(row.ciphertext)), decipher.final()])
      if (content.length !== size) throw new Error('Attachment length mismatch')
      return content
    } catch {
      throw new ServiceUnavailableException('Travel attachment decryption or integrity validation failed')
    }
  }

  private aad(id: string, size: number, createdAt: number) {
    return Buffer.from(`${ROW_AAD_CONTEXT}\0${id}\0${size}\0${createdAt}`, 'utf8')
  }

  private transaction<T>(work: () => T) {
    const database = this.db()
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      database.exec('COMMIT')
      return result
    } catch (cause) {
      database.exec('ROLLBACK')
      throw cause
    }
  }

  private db() {
    if (!this.database) throw new ServiceUnavailableException('Travel attachment database is unavailable')
    return this.database
  }

  private key() {
    if (!this.rowKey) throw new ServiceUnavailableException('Travel attachment encryption key is unavailable')
    return this.rowKey
  }

  private metaBuffer(row: unknown) {
    const value = (row as { value?: Uint8Array } | undefined)?.value
    if (!value) throw new Error('Travel attachment database metadata is missing')
    return Buffer.from(value)
  }

  private async ensureReady() {
    await this.ready
    if (this.loadError) throw new ServiceUnavailableException(this.loadError)
  }

  private assertId(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ServiceUnavailableException('Invalid travel attachment identifier')
  }

  private assertContent(content: Buffer) {
    if (!Buffer.isBuffer(content) || content.length < 1 || content.length > MAX_ATTACHMENT_BYTES) throw new ServiceUnavailableException(`Travel attachment must be between 1 byte and ${MAX_ATTACHMENT_BYTES} bytes`)
  }

  private assertTimestamp(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new ServiceUnavailableException('Invalid travel attachment timestamp')
  }

  private safeError(cause: unknown) {
    return (cause instanceof Error ? cause.message : 'Travel attachment database initialization failed').replace(/[\r\n]/g, ' ').slice(0, 240)
  }
}

export const TRAVEL_ATTACHMENT_LIMITS = {
  perFileBytes: MAX_ATTACHMENT_BYTES,
  perTripBytes: 24 * 1024 * 1024,
  perTripCount: 100
} as const
