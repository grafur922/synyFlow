import type { Task } from '../shared/task'

const BACKUP_KEYS = [
  'terra_tasks',
  'taskflow_theme',
  'terra_primary_sidebar_width',
  'terra_primary_sidebar_collapsed',
  'terra_notes_secondary_sidebar_width',
  'terra_notes_secondary_sidebar_hidden',
  'terra_notes_tabs_visible',
  'terra_notes_outline_visible',
  'terra_notes_open_tabs'
] as const

const ITERATIONS = 310_000
const MIN_PASSPHRASE_LENGTH = 16
const MAX_BACKUP_BYTES = 8 * 1024 * 1024
const ADDITIONAL_DATA = new TextEncoder().encode('terra-client-backup-v1')

type BackupKey = typeof BACKUP_KEYS[number]
type ClientBackupPayload = {
  format: 'terra-client-backup-payload'
  version: 1
  createdAt: string
  values: Record<BackupKey, string | null>
}
type ClientBackupEnvelope = {
  format: 'terra-client-backup'
  version: 1
  algorithm: 'aes-256-gcm'
  kdf: 'pbkdf2-sha256'
  iterations: number
  createdAt: string
  salt: string
  iv: string
  ciphertext: string
}

export async function exportClientBackup(passphrase: string) {
  assertPassphrase(passphrase)
  return encryptPayload(snapshot(), passphrase)
}

export async function restoreClientBackup(serialized: string, passphrase: string) {
  assertPassphrase(passphrase)
  if (new TextEncoder().encode(serialized).length > MAX_BACKUP_BYTES) throw new Error('客户端备份文件过大')
  const payload = await decryptPayload(serialized, passphrase)
  const validated = validatePayload(payload)
  const values = validated.values
  const beforeRestore = await encryptPayload(snapshot(), passphrase)
  const originals = Object.fromEntries(BACKUP_KEYS.map((key) => [key, localStorage.getItem(key)])) as Record<BackupKey, string | null>

  try {
    for (const key of BACKUP_KEYS) {
      const value = values[key]
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
  } catch (cause) {
    for (const key of BACKUP_KEYS) {
      const value = originals[key]
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    throw cause
  }

  return { beforeRestore, tasks: parseTasks(values.terra_tasks), createdAt: validated.createdAt }
}

export function downloadClientBackup(serialized: string, prefix = 'terra-client-backup') {
  const blob = new Blob([serialized], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  anchor.href = url
  anchor.download = `${prefix}-${timestamp}.terra-client-backup`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function snapshot(): ClientBackupPayload {
  return {
    format: 'terra-client-backup-payload',
    version: 1,
    createdAt: new Date().toISOString(),
    values: Object.fromEntries(BACKUP_KEYS.map((key) => [key, localStorage.getItem(key)])) as Record<BackupKey, string | null>
  }
}

async function encryptPayload(payload: ClientBackupPayload, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ['encrypt'])
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA }, key, plaintext)
  const envelope: ClientBackupEnvelope = {
    format: 'terra-client-backup',
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'pbkdf2-sha256',
    iterations: ITERATIONS,
    createdAt: payload.createdAt,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

async function decryptPayload(serialized: string, passphrase: string) {
  let envelope: Partial<ClientBackupEnvelope>
  try { envelope = JSON.parse(serialized) as Partial<ClientBackupEnvelope> }
  catch { throw new Error('客户端备份不是有效 JSON') }
  if (envelope.format !== 'terra-client-backup' || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm' || envelope.kdf !== 'pbkdf2-sha256' || envelope.iterations !== ITERATIONS || typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new Error('客户端备份格式不受支持')
  }
  try {
    const salt = fromBase64(envelope.salt)
    const iv = fromBase64(envelope.iv)
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid parameters')
    const key = await deriveKey(passphrase, salt, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA }, key, fromBase64(envelope.ciphertext))
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
  } catch {
    throw new Error('客户端备份解密失败，请检查口令与文件完整性')
  }
}

function validatePayload(value: unknown) {
  const payload = value as Partial<ClientBackupPayload>
  if (!payload || payload.format !== 'terra-client-backup-payload' || payload.version !== 1 || typeof payload.createdAt !== 'string' || !payload.values || typeof payload.values !== 'object' || Array.isArray(payload.values)) throw new Error('客户端备份内容校验失败')
  const values = payload.values as Record<string, unknown>
  if (Object.keys(values).some((key) => !BACKUP_KEYS.includes(key as BackupKey))) throw new Error('客户端备份包含未知数据项')
  for (const key of BACKUP_KEYS) if (values[key] !== null && typeof values[key] !== 'string') throw new Error(`客户端备份项 ${key} 无效`)

  parseTasks(values.terra_tasks as string | null)
  validateEnum(values.taskflow_theme, ['forest', 'ocean', 'clay', 'amber'], '主题')
  validateNumber(values.terra_primary_sidebar_width, 208, 360, '一级侧边栏宽度')
  validateBoolean(values.terra_primary_sidebar_collapsed, '一级侧边栏状态')
  validateNumber(values.terra_notes_secondary_sidebar_width, 280, 560, '笔记侧边栏宽度')
  validateBoolean(values.terra_notes_secondary_sidebar_hidden, '笔记侧边栏状态')
  validateBoolean(values.terra_notes_tabs_visible, '笔记标签状态')
  validateBoolean(values.terra_notes_outline_visible, '笔记标题导航状态')
  validateOpenTabs(values.terra_notes_open_tabs)
  return { values: values as Record<BackupKey, string | null>, createdAt: payload.createdAt }
}

function parseTasks(value: string | null) {
  if (value === null) return []
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Todo 本地数据不是有效 JSON') }
  if (!Array.isArray(parsed) || parsed.length > 20_000 || !parsed.every(isTask)) throw new Error('Todo 本地数据校验失败')
  return parsed as Task[]
}

function isTask(value: unknown): value is Task {
  const task = value as Partial<Task>
  return Boolean(task && typeof task.id === 'string' && task.id.length <= 200 && typeof task.title === 'string' && task.title.length <= 500 && typeof task.category === 'string' && task.category.length <= 100 && typeof task.date === 'string' && task.date.length <= 20 && (task.timeStart === undefined || typeof task.timeStart === 'string') && (task.timeEnd === undefined || typeof task.timeEnd === 'string') && ['Low', 'Medium', 'High'].includes(String(task.priority)) && typeof task.notes === 'string' && task.notes.length <= 20_000 && typeof task.completed === 'boolean')
}

function validateEnum(value: unknown, options: string[], label: string) {
  if (value !== null && (typeof value !== 'string' || !options.includes(value))) throw new Error(`${label}数据无效`)
}

function validateBoolean(value: unknown, label: string) {
  if (value !== null && value !== 'true' && value !== 'false') throw new Error(`${label}数据无效`)
}

function validateNumber(value: unknown, min: number, max: number, label: string) {
  if (value === null) return
  const number = Number(value)
  if (typeof value !== 'string' || !Number.isFinite(number) || number < min || number > max) throw new Error(`${label}数据无效`)
}

function validateOpenTabs(value: unknown) {
  if (value === null) return
  if (typeof value !== 'string') throw new Error('笔记标签数据无效')
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('笔记标签数据不是有效 JSON') }
  if (!Array.isArray(parsed) || parsed.length > 10 || !parsed.every((item) => Boolean(item && typeof item.id === 'string' && item.id.length <= 64 && typeof item.title === 'string' && item.title.length <= 300))) throw new Error('笔记标签数据校验失败')
}

async function deriveKey(passphrase: string, salt: Uint8Array, usages: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, usages)
}

function assertPassphrase(value: string) {
  if (value.length < MIN_PASSPHRASE_LENGTH) throw new Error(`备份口令至少需要 ${MIN_PASSPHRASE_LENGTH} 个字符`)
}

function toBase64(value: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < value.length; offset += 32_768) binary += String.fromCharCode(...value.subarray(offset, offset + 32_768))
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
