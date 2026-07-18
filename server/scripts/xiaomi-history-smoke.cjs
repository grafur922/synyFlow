const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { createCipheriv, createHash, randomBytes, scryptSync } = require('node:crypto')
const { basename, join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { DatabaseSync } = require('node:sqlite')

require('reflect-metadata')

const tempRoot = resolve(mkdtempSync(join(tmpdir(), 'terra-xiaomi-history-')))
const historyDatabase = join(tempRoot, 'history.sqlite')
const legacyHistory = join(tempRoot, 'history.json')
const encryptionKey = randomBytes(32).toString('hex')
process.env.TERRA_XIAOMI_HISTORY_DB = historyDatabase
process.env.TERRA_XIAOMI_HISTORY_FILE = legacyHistory
process.env.TERRA_HISTORY_ENCRYPTION_KEY = encryptionKey

const { XiaomiNoteHistoryService } = require('../dist/xiaomi-notes/xiaomi-note-history.service')

async function main() {
  const noteA = note('50993292568436800', 'History alpha', 'alpha-private-v1', 100)
  const noteB = note('50993292568436801', 'History beta', 'beta-private-v1', 100)
  const legacyEntry = entry(noteA.id, 'History alpha legacy', 'alpha-private-v0', 1_700_000_000_000, 90, 'before_update')
  writeLegacyEnvelope(legacyHistory, [legacyEntry], encryptionKey)

  const service = new XiaomiNoteHistoryService()
  const migrated = await service.findAll(noteA.id)
  const migratedStatus = service.getStorageStatus()
  assert(migrated.length === 1 && migrated[0].id === legacyEntry.id, 'encrypted legacy history was not migrated')
  assert(migratedStatus.format === 'sqlite' && migratedStatus.encryptedAtRest && migratedStatus.migratedFrom === 'encrypted', 'SQLite migration status is incorrect')

  const first = await service.capture(noteA, 'manual')
  const duplicate = await service.capture(noteA, 'before_update')
  assert(first.id === duplicate.id, 'automatic duplicate snapshot was not deduplicated')
  await service.capture({ ...noteA, content: 'alpha-private-v2', modifyDate: 200 }, 'before_update')
  await service.capture(noteB, 'before_delete')

  const summaries = await service.findAll(noteA.id)
  assert(summaries.length === 3 && !Object.hasOwn(summaries[0], 'content'), 'history summary boundary is incorrect')
  const selected = await service.findOne(noteA.id, summaries[0].id)
  assert(selected.content === 'alpha-private-v2', 'history detail did not return the selected version')
  const archive = await service.findArchive()
  assert(archive.length === 2 && archive.find((group) => group.noteId === noteA.id).versionCount === 3, 'SQLite archive grouping is incorrect')
  await expectStatus(() => service.removeOne(noteB.id, selected.id), 404)

  await service.removeOne(noteA.id, selected.id)
  assert((await service.findAll(noteA.id)).length === 2, 'single history deletion failed')
  const cleared = await service.removeAll(noteA.id)
  assert(cleared.removed === 2 && (await service.findAll(noteA.id)).length === 0, 'single-note history cleanup failed')
  assert((await service.findAll(noteB.id)).length === 1, 'history cleanup affected another note')

  const retentionNote = note('50993292568436803', 'Retention note', '', 100)
  for (let index = 0; index < 65; index += 1) {
    await service.capture({ ...retentionNote, content: `retention-private-${index}`, modifyDate: 100 + index }, 'manual')
  }
  const retained = await service.findAll(retentionNote.id)
  assert(retained.length === 60, 'per-note SQLite history retention limit is incorrect')
  assert((await service.findOne(retentionNote.id, retained[0].id)).content === 'retention-private-64', 'rapid snapshots were not ordered monotonically')
  await service.removeAll(retentionNote.id)

  assertSqliteEncrypted(historyDatabase, [noteA.id, noteB.id, 'History alpha', 'alpha-private', 'beta-private'])
  const legacyRaw = readFileSync(legacyHistory, 'utf8')
  assert(!legacyRaw.includes('alpha-private') && JSON.parse(legacyRaw).format === 'terra-encrypted-history', 'encrypted legacy source was not preserved safely')

  await service.onModuleDestroy()
  const reloaded = new XiaomiNoteHistoryService()
  assert((await reloaded.findAll(noteB.id)).length === 1, 'encrypted SQLite history did not reload')
  await reloaded.onModuleDestroy()

  const encryptedBeforeWrongKey = readFileSync(historyDatabase)
  process.env.TERRA_HISTORY_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  const wrongKey = new XiaomiNoteHistoryService()
  await expectStatus(() => wrongKey.findAll(noteB.id), 503)
  await wrongKey.onModuleDestroy()
  assert(hash(readFileSync(historyDatabase)) === hash(encryptedBeforeWrongKey), 'wrong key modified the SQLite history database')

  process.env.TERRA_HISTORY_ENCRYPTION_KEY = encryptionKey
  const recovered = new XiaomiNoteHistoryService()
  assert((await recovered.findAll(noteB.id)).length === 1, 'correct key could not reopen history after a wrong-key attempt')
  await recovered.onModuleDestroy()

  const wrongLegacyDatabase = join(tempRoot, 'wrong-legacy.sqlite')
  const wrongLegacy = join(tempRoot, 'wrong-legacy.json')
  writeLegacyEnvelope(wrongLegacy, [legacyEntry], encryptionKey)
  const wrongLegacyBefore = readFileSync(wrongLegacy)
  process.env.TERRA_XIAOMI_HISTORY_DB = wrongLegacyDatabase
  process.env.TERRA_XIAOMI_HISTORY_FILE = wrongLegacy
  process.env.TERRA_HISTORY_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  const wrongLegacyKey = new XiaomiNoteHistoryService()
  await expectStatus(() => wrongLegacyKey.findAll(noteA.id), 503)
  await wrongLegacyKey.onModuleDestroy()
  assert(hash(readFileSync(wrongLegacy)) === hash(wrongLegacyBefore) && !existsSync(wrongLegacyDatabase), 'wrong legacy key modified the source or created a database')

  const plainDatabase = join(tempRoot, 'plain-history.sqlite')
  const plainLegacy = join(tempRoot, 'plain-history.json')
  const plainEntry = entry('50993292568436802', 'Plain legacy title', 'plain-legacy-private-body', 1_700_000_000_100, 100, 'manual')
  writeFileSync(plainLegacy, `${JSON.stringify([plainEntry], null, 2)}\n`)
  process.env.TERRA_XIAOMI_HISTORY_DB = plainDatabase
  process.env.TERRA_XIAOMI_HISTORY_FILE = plainLegacy
  process.env.TERRA_HISTORY_ENCRYPTION_KEY = encryptionKey
  const plaintextMigration = new XiaomiNoteHistoryService()
  assert((await plaintextMigration.findAll(plainEntry.noteId)).length === 1, 'plaintext legacy history was not migrated')
  assert(plaintextMigration.getStorageStatus().migratedFrom === 'plain', 'plaintext migration status is incorrect')
  assert(!readFileSync(plainLegacy, 'utf8').includes('plain-legacy-private-body'), 'plaintext legacy source remained on disk after migration')
  assertSqliteEncrypted(plainDatabase, [plainEntry.noteId, plainEntry.title, plainEntry.content])
  await plaintextMigration.onModuleDestroy()

  console.log(JSON.stringify({
    encryptedLegacyMigrated: true,
    plaintextLegacyReencrypted: true,
    sqliteQueryable: true,
    rowEncryption: 'aes-256-gcm',
    lookupIndex: 'hmac-sha256',
    perNoteRetention: 60,
    duplicateSnapshotDeduplicated: true,
    summaryOmitsContent: true,
    singleVersionDeleted: true,
    singleNoteCleared: true,
    otherNotePreserved: true,
    encryptedReloaded: true,
    wrongKeyProtected: true,
    wrongLegacyKeyProtected: true
  }, null, 2))
}

function note(id, title, content, modifyDate) {
  return {
    id,
    tag: id,
    title,
    content,
    preview: content,
    createDate: 50,
    modifyDate,
    colorId: 0,
    folderId: '0',
    status: 'normal',
    hasRichFormatting: false
  }
}

function entry(noteId, title, content, capturedAt, sourceModifyDate, reason) {
  return {
    id: `history-${capturedAt}-a1b2c3d4`,
    noteId,
    title,
    content,
    preview: content.slice(0, 180),
    capturedAt,
    sourceModifyDate,
    reason
  }
}

function writeLegacyEnvelope(path, entries, secret) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(secret, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries), 'utf8'), cipher.final()])
  const envelope = {
    format: 'terra-encrypted-history',
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`)
}

function assertSqliteEncrypted(path, forbiddenValues) {
  const raw = readFileSync(path)
  assert(raw.subarray(0, 16).toString('utf8') === 'SQLite format 3\0', 'history store is not SQLite')
  for (const value of forbiddenValues) assert(!raw.includes(Buffer.from(value, 'utf8')), `SQLite history leaked '${value}'`)
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const integrity = database.prepare('PRAGMA quick_check').get()
    const count = database.prepare('SELECT COUNT(*) count FROM history_entries').get().count
    const row = database.prepare('SELECT note_key, payload, iv, auth_tag FROM history_entries LIMIT 1').get()
    assert(integrity.quick_check === 'ok' && Number(count) > 0, 'SQLite integrity or row count check failed')
    assert(row.note_key.length === 32 && row.iv.length === 12 && row.auth_tag.length === 16 && row.payload.length > 0, 'encrypted SQLite row shape is invalid')
  } finally {
    database.close()
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function expectStatus(work, status) {
  try {
    await work()
  } catch (error) {
    if (typeof error.getStatus === 'function' && error.getStatus() === status) return
    throw error
  }
  throw new Error(`Expected HTTP exception ${status}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function cleanup() {
  const tempBase = resolve(tmpdir())
  if (!tempRoot.startsWith(`${tempBase}\\`) && !tempRoot.startsWith(`${tempBase}/`)) return
  if (!basename(tempRoot).startsWith('terra-xiaomi-history-')) return
  if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(cleanup)
