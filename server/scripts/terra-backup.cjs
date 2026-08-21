const { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } = require('node:crypto')
const { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const net = require('node:net')
const { basename, dirname, join, resolve } = require('node:path')
const { StringDecoder } = require('node:string_decoder')

const SERVER_ROOT = resolve(__dirname, '..')
const MAX_FILE_BYTES = 300 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_DIRECTORY_FILES = 100_000
const MIN_PASSPHRASE_LENGTH = 16

loadLocalEnv()

const RESOURCE_STORE_PATH = configuredPath('TERRA_RESOURCE_FILE', 'data/resources.json')
const XIAOMI_HISTORY_STORE_PATH = configuredHistoryPath()
const STORE_DEFINITIONS = [
  { key: 'tasks', path: configuredPath('TERRA_DATA_FILE', 'data/tasks.json') },
  { key: 'resources', path: RESOURCE_STORE_PATH },
  { key: 'resourceSync', path: resolve(process.env.TERRA_RESOURCE_SYNC_FILE || join(dirname(RESOURCE_STORE_PATH), 'resource-sync.json')) },
  { key: 'rss', path: configuredPath('TERRA_RSS_FILE', 'data/rss.json') },
  { key: 'blog', path: configuredPath('TERRA_BLOG_FILE', 'data/blog.json') },
  { key: 'travel', path: configuredPath('TERRA_TRAVEL_FILE', 'data/travel.json') },
  { key: 'travelAttachments', path: configuredPath('TERRA_TRAVEL_ATTACHMENTS_DB', 'data/travel-attachments.sqlite') },
  { key: 'rag', path: configuredPath('TERRA_RAG_FILE', 'data/rag.json') },
  { key: 'ragVectors', path: configuredPath('TERRA_RAG_VECTOR_PATH', 'data/rag-vectors'), directory: true },
  { key: 'xiaomiHistory', path: XIAOMI_HISTORY_STORE_PATH },
  { key: 'xiaomiMetadata', path: configuredPath('TERRA_XIAOMI_METADATA_FILE', 'data/xiaomi-note-metadata.json') }
]
const LEGACY_OPTIONAL_STORE_KEYS = new Set(['resourceSync', 'travelAttachments', 'ragVectors'])

main().catch((error) => {
  console.error(safeError(error))
  process.exitCode = 1
})

async function main() {
  const [command, backupPath, ...rest] = process.argv.slice(2)
  if (!['export', 'inspect', 'restore'].includes(command)) throw new Error('Usage: npm run backup -- export | inspect <file> | restore <file> --confirm <backup-id>')
  const passphrase = await readPassphrase()

  if (command === 'export') {
    await assertServerStopped()
    console.log(JSON.stringify(exportBackup(passphrase, 'manual'), null, 2))
    return
  }

  if (!backupPath) throw new Error(`${command} requires a backup file path`)
  const inspected = inspectBackup(resolve(backupPath), passphrase)
  if (command === 'inspect') {
    console.log(JSON.stringify(inspected, null, 2))
    return
  }

  const confirmIndex = rest.indexOf('--confirm')
  const confirmation = confirmIndex >= 0 ? rest[confirmIndex + 1] : ''
  if (confirmation !== inspected.id) throw new Error(`Restore confirmation mismatch. Inspect the backup, then pass --confirm ${inspected.id}`)
  await assertServerStopped()
  const preRestore = exportBackup(passphrase, 'pre-restore')
  const restored = restoreBackup(resolve(backupPath), passphrase)
  console.log(JSON.stringify({ ...restored, preRestoreBackup: preRestore.path }, null, 2))
}

function exportBackup(passphrase, reason) {
  const files = []
  let totalBytes = 0
  for (const definition of STORE_DEFINITIONS) {
    if (!existsSync(definition.path)) {
      files.push({ key: definition.key, missing: true })
      continue
    }
    const info = lstatSync(definition.path)
    if (info.isSymbolicLink() || (definition.directory ? !info.isDirectory() : !info.isFile())) {
      throw new Error(`Store '${definition.key}' is not a regular ${definition.directory ? 'directory' : 'file'}`)
    }
    const content = definition.directory ? encodeDirectoryStore(definition.path) : readFileSync(definition.path)
    if (content.length > MAX_FILE_BYTES) throw new Error(`Store '${definition.key}' exceeds the per-store backup limit`)
    totalBytes += content.length
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Terra stores exceed the total backup limit')
    files.push({ key: definition.key, missing: false, size: content.length, sha256: hash(content), content: content.toString('base64') })
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const payload = { format: 'terra-backup-payload', version: 1, id, createdAt, reason, files }
  const envelope = encryptPayload(payload, passphrase, {
    id,
    createdAt,
    reason,
    fileCount: files.filter((file) => !file.missing).length,
    totalBytes
  })
  const backupDirectory = resolve(process.env.TERRA_BACKUP_DIR || join(SERVER_ROOT, 'data', 'backups'))
  ensureSafeDirectory(backupDirectory)
  const timestamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const filename = `terra-backup-${timestamp}-${id.slice(0, 8)}.terra-backup`
  const target = join(backupDirectory, filename)
  const temp = `${target}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  renameSync(temp, target)
  return { id, createdAt, reason, path: target, fileCount: envelope.fileCount, totalBytes }
}

function inspectBackup(path, passphrase) {
  const payload = decryptBackup(path, passphrase)
  return {
    id: payload.id,
    createdAt: payload.createdAt,
    reason: payload.reason,
    files: payload.files.map((file) => ({ key: file.key, missing: file.missing, size: file.missing ? 0 : file.size, sha256: file.missing ? undefined : file.sha256 })),
    totalBytes: payload.files.reduce((sum, file) => sum + (file.missing ? 0 : file.size), 0)
  }
}

function restoreBackup(path, passphrase) {
  const payload = decryptBackup(path, passphrase)
  const targetPaths = new Set()
  const filesByKey = new Map(payload.files.map((file) => [file.key, file]))
  const plans = STORE_DEFINITIONS.map((definition) => {
    const file = filesByKey.get(definition.key) || { key: definition.key, missing: true }
    const normalizedTarget = resolve(definition.path).toLocaleLowerCase('en-US')
    if (targetPaths.has(normalizedTarget)) throw new Error('Multiple stores resolve to the same restore target')
    targetPaths.add(normalizedTarget)
    if (existsSync(definition.path)) {
      const info = lstatSync(definition.path)
      if (info.isSymbolicLink() || (definition.directory ? !info.isDirectory() : !info.isFile())) {
        throw new Error(`Restore target '${file.key}' is not a regular ${definition.directory ? 'directory' : 'file'}`)
      }
    }
    const content = file.missing ? undefined : decodeAndValidate(file)
    return {
      key: file.key,
      target: definition.path,
      directory: Boolean(definition.directory),
      content,
      directoryFiles: definition.directory && content ? decodeDirectoryStore(content) : undefined,
      temp: `${definition.path}.terra-restore-${payload.id}.tmp`,
      rollback: `${definition.path}.terra-restore-${payload.id}.bak`,
      hadOriginal: false,
      installed: false
    }
  })

  for (const plan of plans) {
    mkdirSync(dirname(plan.target), { recursive: true })
    rmSync(plan.temp, { recursive: plan.directory, force: true })
    rmSync(plan.rollback, { recursive: plan.directory, force: true })
    if (!plan.content) continue
    if (!plan.directory) {
      writeFileSync(plan.temp, plan.content, { mode: 0o600, flag: 'wx' })
      continue
    }
    mkdirSync(plan.temp, { recursive: false, mode: 0o700 })
    for (const entry of plan.directoryFiles) {
      const target = safeArchiveTarget(plan.temp, entry.path)
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeFileSync(target, entry.content, { mode: 0o600, flag: 'wx' })
    }
  }

  try {
    for (const plan of plans) {
      if (existsSync(plan.target)) {
        renameSync(plan.target, plan.rollback)
        plan.hadOriginal = true
      }
      if (plan.content) {
        renameSync(plan.temp, plan.target)
        plan.installed = true
      }
    }
    for (const plan of plans) rmSync(plan.rollback, { recursive: plan.directory, force: true })
  } catch (error) {
    for (const plan of [...plans].reverse()) {
      if (plan.installed) rmSync(plan.target, { recursive: plan.directory, force: true })
      if (plan.hadOriginal && existsSync(plan.rollback)) renameSync(plan.rollback, plan.target)
      rmSync(plan.temp, { recursive: plan.directory, force: true })
    }
    throw error
  }

  return { id: payload.id, restoredFiles: plans.filter((plan) => Boolean(plan.content)).length, removedMissingStores: plans.filter((plan) => !plan.content).length }
}

function encryptPayload(payload, passphrase, metadata) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    format: 'terra-backup',
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    ...metadata,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

function decryptBackup(path, passphrase) {
  if (!existsSync(path)) throw new Error('Backup file was not found')
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_TOTAL_BYTES * 1.5) throw new Error('Backup path is unsafe or too large')
  let envelope
  try { envelope = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) }
  catch { throw new Error('Backup is not valid JSON') }
  if (envelope.format !== 'terra-backup' || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm' || envelope.kdf !== 'scrypt') throw new Error('Backup format is unsupported')

  try {
    const key = scryptSync(passphrase, Buffer.from(envelope.salt, 'base64'), 32)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')
    const payload = JSON.parse(plaintext)
    validatePayload(payload, envelope)
    return payload
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Backup payload')) throw error
    throw new Error('Backup decryption failed; check the passphrase and file integrity')
  }
}

function validatePayload(payload, envelope) {
  if (payload?.format !== 'terra-backup-payload' || payload.version !== 1 || payload.id !== envelope.id || !Array.isArray(payload.files)) throw new Error('Backup payload failed validation')
  const knownKeys = new Set(STORE_DEFINITIONS.map((definition) => definition.key))
  const seen = new Set()
  let total = 0
  for (const file of payload.files) {
    if (!knownKeys.has(file.key) || seen.has(file.key) || typeof file.missing !== 'boolean') throw new Error('Backup payload contains an invalid store entry')
    seen.add(file.key)
    if (file.missing) continue
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES || typeof file.sha256 !== 'string' || typeof file.content !== 'string') throw new Error('Backup payload contains invalid file metadata')
    total += file.size
    if (total > MAX_TOTAL_BYTES) throw new Error('Backup payload exceeds the total size limit')
    decodeAndValidate(file)
  }
  const missingKeys = [...knownKeys].filter((key) => !seen.has(key))
  if (missingKeys.some((key) => !LEGACY_OPTIONAL_STORE_KEYS.has(key))) throw new Error('Backup payload has an incomplete store manifest')
}

function decodeAndValidate(file) {
  const content = Buffer.from(file.content, 'base64')
  if (content.length !== file.size || hash(content) !== file.sha256) throw new Error(`Backup payload checksum failed for '${file.key}'`)
  return content
}

function encodeDirectoryStore(root) {
  const files = []
  const visit = (directory, prefix = '') => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en-US'))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`Directory store contains a symbolic link: ${entry.name}`)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      assertSafeArchivePath(relative)
      if (isForbiddenBackupName(entry.name)) throw new Error(`Directory store contains a forbidden credential-like file: ${entry.name}`)
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(absolute, relative)
        continue
      }
      if (!entry.isFile()) throw new Error(`Directory store contains an unsupported entry: ${relative}`)
      if (files.length >= MAX_DIRECTORY_FILES) throw new Error('Directory store contains too many files')
      const info = lstatSync(absolute)
      if (info.size > MAX_FILE_BYTES) throw new Error(`Directory store file exceeds the per-file limit: ${relative}`)
      const content = readFileSync(absolute)
      files.push({ path: relative, size: content.length, sha256: hash(content), content: content.toString('base64') })
    }
  }
  visit(root)
  return Buffer.from(JSON.stringify({ format: 'terra-directory-store', version: 1, files }), 'utf8')
}

function decodeDirectoryStore(content) {
  let archive
  try { archive = JSON.parse(content.toString('utf8')) }
  catch { throw new Error('Backup directory store is not valid JSON') }
  if (archive?.format !== 'terra-directory-store' || archive.version !== 1 || !Array.isArray(archive.files) || archive.files.length > MAX_DIRECTORY_FILES) {
    throw new Error('Backup directory store failed validation')
  }
  const seen = new Set()
  let total = 0
  return archive.files.map((entry) => {
    if (!entry || typeof entry.path !== 'string' || seen.has(entry.path)) throw new Error('Backup directory store contains an invalid path')
    assertSafeArchivePath(entry.path)
    const name = entry.path.split('/').at(-1)
    if (isForbiddenBackupName(name)) throw new Error('Backup directory store contains a forbidden credential-like file')
    seen.add(entry.path)
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES || typeof entry.sha256 !== 'string' || typeof entry.content !== 'string') {
      throw new Error('Backup directory store contains invalid file metadata')
    }
    const decoded = Buffer.from(entry.content, 'base64')
    if (decoded.length !== entry.size || hash(decoded) !== entry.sha256) throw new Error(`Backup directory checksum failed for '${entry.path}'`)
    total += decoded.length
    if (total > MAX_TOTAL_BYTES) throw new Error('Backup directory store exceeds the total size limit')
    return { path: entry.path, content: decoded }
  })
}

function assertSafeArchivePath(value) {
  if (!value || value.length > 1024 || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('Directory store contains an unsafe path')
  }
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('Directory store contains an unsafe path')
}

function safeArchiveTarget(root, relative) {
  assertSafeArchivePath(relative)
  const target = resolve(root, ...relative.split('/'))
  const normalizedRoot = `${resolve(root)}${require('node:path').sep}`
  if (!target.startsWith(normalizedRoot)) throw new Error('Directory restore target escaped its root')
  return target
}

function isForbiddenBackupName(value) {
  const name = String(value || '').toLocaleLowerCase('en-US')
  return name === '.terra-secrets.json' || name === '.env' || name.startsWith('.env.') || name.endsWith('.pem') || name.endsWith('.key') || name.includes('credential') || name.includes('secret')
}

function ensureSafeDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Backup directory is unsafe')
  if (realpathSync(path) !== resolve(path)) throw new Error('Backup directory cannot be a symbolic link or junction')
}

async function assertServerStopped() {
  if (process.env.TERRA_BACKUP_SKIP_SERVER_CHECK === 'true') return
  const hostValue = (process.env.TERRA_API_HOST || '127.0.0.1').trim()
  const host = hostValue === '0.0.0.0' || hostValue === '::' ? '127.0.0.1' : hostValue
  const port = Number(process.env.PORT || process.env.TERRA_API_PORT || 3001)
  if (await canConnect(host, port)) throw new Error(`Terra Server is listening on ${host}:${port}; stop it before export or restore`)
}

function canConnect(host, port) {
  return new Promise((resolveConnection) => {
    const socket = net.createConnection({ host, port })
    const finish = (connected) => { socket.destroy(); resolveConnection(connected) }
    socket.setTimeout(400, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function readPassphrase() {
  const configured = process.env.TERRA_BACKUP_PASSPHRASE || ''
  const value = configured || await readHiddenInput('Backup passphrase: ')
  if (value.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Backup passphrase must contain at least ${MIN_PASSPHRASE_LENGTH} characters`)
  return value
}

function readHiddenInput(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') throw new Error('Set TERRA_BACKUP_PASSPHRASE when no interactive terminal is available')
  return new Promise((resolveInput, reject) => {
    let value = ''
    const decoder = new StringDecoder('utf8')
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const onData = (buffer) => {
      let segmentStart = 0
      for (let index = 0; index < buffer.length; index += 1) {
        const byte = buffer[index]
        if (![3, 8, 10, 13, 127].includes(byte)) continue
        value += decoder.write(buffer.subarray(segmentStart, index))
        segmentStart = index + 1
        if (byte === 3) { cleanup(); reject(new Error('Backup command cancelled')); return }
        if (byte === 13 || byte === 10) { value += decoder.end(); cleanup(); process.stdout.write('\n'); resolveInput(value); return }
        value = [...value].slice(0, -1).join('')
      }
      value += decoder.write(buffer.subarray(segmentStart))
    }
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause() }
    process.stdin.on('data', onData)
  })
}

function configuredPath(environmentName, fallback) {
  return resolve(process.env[environmentName] || join(SERVER_ROOT, fallback))
}

function configuredHistoryPath() {
  if (process.env.TERRA_XIAOMI_HISTORY_DB) {
    const database = resolve(process.env.TERRA_XIAOMI_HISTORY_DB)
    if (existsSync(database)) return database
    for (const legacyValue of [process.env.TERRA_XIAOMI_HISTORY_LEGACY_FILE, process.env.TERRA_XIAOMI_HISTORY_FILE]) {
      if (legacyValue && existsSync(resolve(legacyValue))) return resolve(legacyValue)
    }
    return database
  }
  if (process.env.TERRA_XIAOMI_HISTORY_FILE) return resolve(process.env.TERRA_XIAOMI_HISTORY_FILE)
  const database = resolve(SERVER_ROOT, 'data', 'xiaomi-note-history.sqlite')
  const legacy = resolve(SERVER_ROOT, 'data', 'xiaomi-note-history.json')
  return existsSync(database) || !existsSync(legacy) ? database : legacy
}

function loadLocalEnv() {
  const path = join(SERVER_ROOT, '.env')
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeError(error) {
  return (error instanceof Error ? error.message : 'Backup command failed').replace(/[\r\n]/g, ' ').slice(0, 500)
}
