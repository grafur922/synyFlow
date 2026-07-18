import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Trip, TripAttachment } from './travel.model'

const MIN_PASSPHRASE_LENGTH = 16
const MAX_PASSPHRASE_LENGTH = 1_024
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024
const MAX_PAYLOAD_BYTES = 48 * 1024 * 1024
const PACKAGE_AAD = Buffer.from('terra-trip-package:v1:gzip', 'utf8')

export type TravelOfflinePackagePayload = {
  format: 'terra-trip-package-payload'
  version: 1
  exportedAt: number
  trip: Trip
  attachments: Array<{ metadata: TripAttachment; content: string }>
}

type TravelOfflinePackageEnvelope = {
  format: 'terra-trip-package'
  version: 1
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  compression: 'gzip'
  salt: string
  iv: string
  authTag: string
  ciphertext: string
}

export function encryptTravelOfflinePackage(payload: TravelOfflinePackagePayload, passphrase: string) {
  assertPassphrase(passphrase)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('Offline trip package payload is too large')
  const compressed = gzipSync(plaintext, { level: 6 })
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(PACKAGE_AAD)
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
    const envelope: TravelOfflinePackageEnvelope = {
      format: 'terra-trip-package',
      version: 1,
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      compression: 'gzip',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
    const serialized = Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8')
    if (serialized.length > MAX_PACKAGE_BYTES) throw new Error('Offline trip package exceeds the file size limit')
    return serialized
  } finally {
    key.fill(0)
  }
}

export function decryptTravelOfflinePackage(content: Buffer, passphrase: string): TravelOfflinePackagePayload {
  assertPassphrase(passphrase)
  if (!Buffer.isBuffer(content) || content.length < 1 || content.length > MAX_PACKAGE_BYTES) throw new Error('Offline trip package file size is invalid')
  let envelope: TravelOfflinePackageEnvelope
  try {
    envelope = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, '')) as TravelOfflinePackageEnvelope
  } catch {
    throw new Error('Offline trip package is not valid JSON')
  }
  if (
    envelope?.format !== 'terra-trip-package' || envelope.version !== 1 ||
    envelope.algorithm !== 'aes-256-gcm' || envelope.kdf !== 'scrypt' || envelope.compression !== 'gzip'
  ) throw new Error('Offline trip package format is unsupported')

  const salt = strictBase64(envelope.salt, 16, 'salt')
  const iv = strictBase64(envelope.iv, 12, 'iv')
  const authTag = strictBase64(envelope.authTag, 16, 'authentication tag')
  const ciphertext = strictBase64(envelope.ciphertext, undefined, 'ciphertext')
  if (!ciphertext.length || ciphertext.length > MAX_PAYLOAD_BYTES) throw new Error('Offline trip package ciphertext size is invalid')

  const key = scryptSync(passphrase, salt, 32)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(PACKAGE_AAD)
    decipher.setAuthTag(authTag)
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const plaintext = gunzipSync(compressed, { maxOutputLength: MAX_PAYLOAD_BYTES })
    const payload = JSON.parse(plaintext.toString('utf8')) as TravelOfflinePackagePayload
    if (payload?.format !== 'terra-trip-package-payload' || payload.version !== 1) throw new Error('Invalid package payload')
    return payload
  } catch {
    throw new Error('Offline trip package decryption failed; check the passphrase and file integrity')
  } finally {
    key.fill(0)
  }
}

function assertPassphrase(value: string) {
  if (typeof value !== 'string' || value.length < MIN_PASSPHRASE_LENGTH || value.length > MAX_PASSPHRASE_LENGTH) {
    throw new Error(`Offline package passphrase must contain ${MIN_PASSPHRASE_LENGTH}-${MAX_PASSPHRASE_LENGTH} characters`)
  }
}

function strictBase64(value: unknown, expectedLength: number | undefined, label: string) {
  if (typeof value !== 'string' || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`Offline trip package ${label} is invalid`)
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value || (expectedLength !== undefined && decoded.length !== expectedLength)) throw new Error(`Offline trip package ${label} is invalid`)
  return decoded
}

export const TRAVEL_OFFLINE_PACKAGE_LIMIT_BYTES = MAX_PACKAGE_BYTES
