const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { createCipheriv, createDecipheriv, randomBytes, scryptSync } = require('node:crypto')
const { join, resolve, basename } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = resolve(mkdtempSync(join(tmpdir(), 'terra-backup-smoke-')))
const backupDir = join(root, 'backups')
mkdirSync(backupDir)
const paths = {
  TERRA_DATA_FILE: join(root, 'tasks.json'),
  TERRA_RESOURCE_FILE: join(root, 'resources.json'),
  TERRA_RESOURCE_SYNC_FILE: join(root, 'resource-sync.json'),
  TERRA_RSS_FILE: join(root, 'rss.json'),
  TERRA_BLOG_FILE: join(root, 'blog.json'),
  TERRA_TRAVEL_FILE: join(root, 'travel.json'),
  TERRA_TRAVEL_ATTACHMENTS_DB: join(root, 'travel-attachments.sqlite'),
  TERRA_RAG_FILE: join(root, 'rag.json'),
  TERRA_XIAOMI_HISTORY_DB: join(root, 'history.sqlite'),
  TERRA_XIAOMI_HISTORY_FILE: join(root, 'history.json'),
  TERRA_XIAOMI_METADATA_FILE: join(root, 'metadata.json')
}
const originalTasks = '{"private":"task fixture"}\n'
const originalRag = '{"private":"rag fixture"}\n'
const originalResourceSync = '{"private":"sync cursor fixture"}\n'
const originalTravelAttachments = Buffer.concat([Buffer.from('SQLite format 3\0', 'utf8'), Buffer.from('private encrypted attachment fixture', 'utf8')])
const originalHistory = Buffer.concat([Buffer.from('SQLite format 3\0', 'utf8'), Buffer.from('private sqlite history fixture', 'utf8')])
const backupPassphrase = 'correct-backup-passphrase-32'

try {
  writeFileSync(paths.TERRA_DATA_FILE, originalTasks)
  writeFileSync(paths.TERRA_RAG_FILE, originalRag)
  writeFileSync(paths.TERRA_RESOURCE_SYNC_FILE, originalResourceSync)
  writeFileSync(paths.TERRA_TRAVEL_ATTACHMENTS_DB, originalTravelAttachments)
  writeFileSync(paths.TERRA_XIAOMI_HISTORY_FILE, originalHistory)
  const commonEnv = {
    ...process.env,
    ...paths,
    TERRA_BACKUP_DIR: backupDir,
    TERRA_BACKUP_PASSPHRASE: backupPassphrase,
    TERRA_BACKUP_SKIP_SERVER_CHECK: 'true'
  }

  const exported = run(['export'], commonEnv)
  const rawBackup = readFileSync(exported.path, 'utf8')
  if (rawBackup.includes('task fixture') || rawBackup.includes('rag fixture') || rawBackup.includes('sync cursor fixture') || rawBackup.includes('encrypted attachment fixture') || rawBackup.includes('sqlite history fixture')) throw new Error('Backup leaked plaintext')
  const inspected = run(['inspect', exported.path], commonEnv)
  if (inspected.id !== exported.id || inspected.files.length !== 10) throw new Error('Backup inspection failed')

  writeFileSync(paths.TERRA_DATA_FILE, '{"changed":true}\n')
  writeFileSync(paths.TERRA_RAG_FILE, '{"changed":true}\n')
  writeFileSync(paths.TERRA_RESOURCE_SYNC_FILE, '{"changed":true}\n')
  writeFileSync(paths.TERRA_TRAVEL_ATTACHMENTS_DB, 'changed attachment database')
  writeFileSync(paths.TERRA_XIAOMI_HISTORY_FILE, '{"changed":true}\n')
  writeFileSync(paths.TERRA_RSS_FILE, '{"createdAfterBackup":true}\n')

  const wrong = spawn(['restore', exported.path, '--confirm', inspected.id], { ...commonEnv, TERRA_BACKUP_PASSPHRASE: 'wrong-backup-passphrase-32' })
  if (wrong.status === 0 || readFileSync(paths.TERRA_DATA_FILE, 'utf8') !== '{"changed":true}\n') throw new Error('Wrong passphrase modified source data')

  const restored = run(['restore', exported.path, '--confirm', inspected.id], commonEnv)
  if (readFileSync(paths.TERRA_DATA_FILE, 'utf8') !== originalTasks || readFileSync(paths.TERRA_RAG_FILE, 'utf8') !== originalRag || readFileSync(paths.TERRA_RESOURCE_SYNC_FILE, 'utf8') !== originalResourceSync || !readFileSync(paths.TERRA_TRAVEL_ATTACHMENTS_DB).equals(originalTravelAttachments) || !readFileSync(paths.TERRA_XIAOMI_HISTORY_FILE).equals(originalHistory)) throw new Error('Restore did not reproduce original files')
  if (existsSync(paths.TERRA_RSS_FILE)) throw new Error('Restore did not remove a store missing from the backup')
  if (!existsSync(restored.preRestoreBackup)) throw new Error('Pre-restore rollback backup was not created')

  const legacyPath = join(root, 'legacy-eight-store.terra-backup')
  createLegacyBackup(exported.path, legacyPath, backupPassphrase)
  const legacyInspected = run(['inspect', legacyPath], commonEnv)
  if (legacyInspected.files.length !== 8) throw new Error('Legacy backup inspection did not preserve the old manifest')
  writeFileSync(paths.TERRA_RESOURCE_SYNC_FILE, '{"newerCursor":true}\n')
  run(['restore', legacyPath, '--confirm', legacyInspected.id], commonEnv)
  if (existsSync(paths.TERRA_RESOURCE_SYNC_FILE)) throw new Error('Legacy restore left a newer Resource cursor store behind')

  console.log(JSON.stringify({ encrypted: true, files: inspected.files.length, wrongPassphraseProtected: true, restored: restored.restoredFiles, removedMissingStores: restored.removedMissingStores, preRestoreBackup: true, legacyManifestMigrated: true }, null, 2))
} finally {
  const tempBase = resolve(tmpdir())
  if ((root.startsWith(`${tempBase}\\`) || root.startsWith(`${tempBase}/`)) && basename(root).startsWith('terra-backup-smoke-')) rmSync(root, { recursive: true, force: true })
}

function run(argumentsList, environment) {
  const result = spawn(argumentsList, environment)
  if (result.status !== 0) throw new Error(result.stderr || `Backup command failed with ${result.status}`)
  return JSON.parse(result.stdout)
}

function spawn(argumentsList, environment) {
  const result = spawnSync(process.execPath, [join(__dirname, 'terra-backup.cjs'), ...argumentsList], {
    cwd: resolve(__dirname, '..'),
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000
  })
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

function createLegacyBackup(source, target, passphrase) {
  const envelope = JSON.parse(readFileSync(source, 'utf8'))
  const key = scryptSync(passphrase, Buffer.from(envelope.salt, 'base64'), 32)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
  const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'))
  payload.files = payload.files.filter((file) => file.key !== 'resourceSync' && file.key !== 'travelAttachments')

  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const nextKey = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', nextKey, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()])
  const nextEnvelope = {
    ...envelope,
    fileCount: payload.files.filter((file) => !file.missing).length,
    totalBytes: payload.files.reduce((sum, file) => sum + (file.missing ? 0 : file.size), 0),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
  writeFileSync(target, `${JSON.stringify(nextEnvelope, null, 2)}\n`)
}
