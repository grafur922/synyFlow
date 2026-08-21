import { ServiceUnavailableException } from '@nestjs/common'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const MIN_SECRET_LENGTH = 16

type StoreFormat = 'new' | 'plain' | 'encrypted' | 'unreadable'
type EncryptedEnvelope = {
  format: string
  version: 1
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  authTag: string
  ciphertext: string
}

export type EncryptedJsonStoreOptions<T> = {
  filePath: string
  encryptionSecret?: string
  encryptedFormat: string
  defaultValue: () => T
  validate: (value: unknown) => value is T
  maxPlaintextBytes?: number
}

export class EncryptedJsonStore<T> {
  private value!: T
  private initializePromise?: Promise<void>
  private operationQueue: Promise<unknown> = Promise.resolve()
  private loadError = ''
  private format: StoreFormat = 'new'

  constructor(private readonly options: EncryptedJsonStoreOptions<T>) {}

  initialize() {
    if (!this.initializePromise) {
      this.initializePromise = this.load().catch((error) => {
        this.format = 'unreadable'
        this.loadError = this.safeError(error)
      })
    }
    return this.initializePromise
  }

  getStatus() {
    const encryptionConfigured = this.hasEncryptionSecret()
    return {
      available: !this.loadError,
      encryptedAtRest: this.format === 'encrypted',
      encryptionConfigured,
      migrationPending: encryptionConfigured && this.format === 'plain',
      format: this.format,
      message: this.loadError || (
        this.format === 'encrypted'
          ? 'Encrypted storage is active'
          : 'Storage is plaintext; configure an encryption key'
      )
    }
  }

  async read() {
    await this.ensureReady()
    return structuredClone(this.value)
  }

  replace(nextValue: T) {
    return this.enqueue(async () => {
      this.assertValid(nextValue)
      this.value = structuredClone(nextValue)
      await this.persistValue(this.value)
      return structuredClone(this.value)
    })
  }

  update(mutator: (draft: T) => T | void | Promise<T | void>) {
    return this.enqueue(async () => {
      const draft = structuredClone(this.value)
      const result = await mutator(draft)
      const nextValue = result === undefined ? draft : result
      this.assertValid(nextValue)
      this.value = structuredClone(nextValue)
      await this.persistValue(this.value)
      return structuredClone(this.value)
    })
  }

  /** Creates a byte-for-byte recovery copy before an explicit schema migration. */
  createRecoveryCopy(label = 'pre-migration') {
    return this.enqueue(async () => {
      const safeLabel = label.replace(/[^a-z0-9._-]/gi, '-').slice(0, 64) || 'pre-migration'
      const recoveryPath = `${this.options.filePath}.${safeLabel}.bak`
      await mkdir(dirname(this.options.filePath), { recursive: true })
      try {
        await copyFile(this.options.filePath, recoveryPath)
        return recoveryPath
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return undefined
        throw error
      }
    })
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const next = this.operationQueue.then(async () => {
      await this.ensureReady()
      return operation()
    }, async () => {
      await this.ensureReady()
      return operation()
    })
    this.operationQueue = next.catch(() => undefined)
    return next
  }

  private async load() {
    const source = await this.readSource()
    if (!source) {
      this.value = this.options.defaultValue()
      this.assertValid(this.value)
      this.format = 'new'
      await this.persistValue(this.value)
      return
    }

    const parsed = this.deserialize(source.raw)
    this.assertValid(parsed.value)
    this.value = structuredClone(parsed.value)
    this.format = parsed.format

    if (source.fromBackup || (this.format === 'plain' && this.hasEncryptionSecret())) {
      await this.persistValue(this.value)
    }
  }

  private async readSource() {
    try {
      return { raw: await readFile(this.options.filePath, 'utf8'), fromBackup: false }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }

    const backupPath = `${this.options.filePath}.bak`
    try {
      return { raw: await readFile(backupPath, 'utf8'), fromBackup: true }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined
      throw error
    }
  }

  private deserialize(raw: string): { value: unknown; format: 'plain' | 'encrypted' } {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Store is not valid JSON; original file was preserved')
    }

    if (!this.isEnvelope(parsed)) return { value: parsed, format: 'plain' }
    if (!this.hasEncryptionSecret()) throw new Error('Store is encrypted but its encryption key is missing')

    try {
      const salt = Buffer.from(parsed.salt, 'base64')
      const iv = Buffer.from(parsed.iv, 'base64')
      const authTag = Buffer.from(parsed.authTag, 'base64')
      const ciphertext = Buffer.from(parsed.ciphertext, 'base64')
      const key = scryptSync(this.options.encryptionSecret!, salt, 32)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
      return { value: JSON.parse(plaintext) as unknown, format: 'encrypted' }
    } catch {
      throw new Error('Store decryption failed; check the key. Original file was preserved')
    }
  }

  private async persistValue(value: T) {
    const serialized = this.serialize(value)
    const directory = dirname(this.options.filePath)
    const tempPath = `${this.options.filePath}.tmp-${process.pid}-${Date.now()}`
    const backupPath = `${this.options.filePath}.bak`

    await mkdir(directory, { recursive: true })
    await writeFile(tempPath, serialized, { encoding: 'utf8', mode: 0o600 })
    await rm(backupPath, { force: true }).catch(() => undefined)

    let movedOriginal = false
    try {
      await stat(this.options.filePath)
      await rename(this.options.filePath, backupPath)
      movedOriginal = true
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        await rm(tempPath, { force: true }).catch(() => undefined)
        throw error
      }
    }

    try {
      await rename(tempPath, this.options.filePath)
      await rm(backupPath, { force: true }).catch(() => undefined)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      if (movedOriginal) await rename(backupPath, this.options.filePath).catch(() => undefined)
      throw error
    }
  }

  private serialize(value: T) {
    const plaintext = JSON.stringify(value)
    const maxBytes = this.options.maxPlaintextBytes ?? 32 * 1024 * 1024
    if (Buffer.byteLength(plaintext, 'utf8') > maxBytes) throw new Error('Store exceeds its configured size budget')

    if (!this.hasEncryptionSecret()) {
      this.format = 'plain'
      return `${JSON.stringify(value, null, 2)}\n`
    }

    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = scryptSync(this.options.encryptionSecret!, salt, 32)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const envelope: EncryptedEnvelope = {
      format: this.options.encryptedFormat,
      version: 1,
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
    this.format = 'encrypted'
    return `${JSON.stringify(envelope, null, 2)}\n`
  }

  private isEnvelope(value: unknown): value is EncryptedEnvelope {
    const item = value as Partial<EncryptedEnvelope>
    return Boolean(
      item &&
      item.format === this.options.encryptedFormat &&
      item.version === 1 &&
      item.algorithm === 'aes-256-gcm' &&
      item.kdf === 'scrypt' &&
      typeof item.salt === 'string' &&
      typeof item.iv === 'string' &&
      typeof item.authTag === 'string' &&
      typeof item.ciphertext === 'string'
    )
  }

  private async ensureReady() {
    await this.initialize()
    if (this.loadError) throw new ServiceUnavailableException(this.loadError)
  }

  private assertValid(value: unknown): asserts value is T {
    if (!this.options.validate(value)) throw new Error('Store data failed schema validation')
  }

  private hasEncryptionSecret() {
    return Boolean(this.options.encryptionSecret && this.options.encryptionSecret.length >= MIN_SECRET_LENGTH)
  }

  private safeError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Encrypted store initialization failed'
    return message.replace(/[\r\n]/g, ' ').slice(0, 240)
  }
}
