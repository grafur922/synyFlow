import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  canWriteWindowsSystemSecrets,
  getXiaomiCloudCookieSource,
  getXiaomiPassportRefreshCredentials,
  getXiaomiPassportRefreshCredentialSource,
  hasEnvironmentXiaomiPassportRefreshCredentials,
  setWindowsSystemSecret,
  setXiaomiPassportRefreshCredentials,
  validateXiaomiPassportRefreshCredentials,
  type XiaomiPassportRefreshCredentials
} from '../security/secrets'

const XIAOMI_ORIGIN = 'https://i.mi.com'
const PASSPORT_HOST = 'account.xiaomi.com'
const LOGIN_PATH = '/api/user/login'
const SERVICE_LOGIN_PATH = '/pass/serviceLogin'
const STS_PATH = '/sts'
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_COOKIE_LENGTH = 24_000
const PASSPORT_USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 15) PassportSDK/5.2.0 TerraHub/0.2'
const ICLOUD_USER_AGENT = 'TerraHub/0.2 (personal Xiaomi Notes connector)'
const INITIAL_ICLOUD_COOKIE_DEFAULTS = {
  uLocale: 'zh_CN',
  iplocale: 'zh_CN',
  'i.mi.com_isvalid_servicetoken': 'true',
  'i.mi.com_istrudev': 'true'
} as const

export type XiaomiRefreshCredentialUpdate = Partial<XiaomiPassportRefreshCredentials>
export type XiaomiRefreshStatus = {
  configured: boolean
  source: 'environment' | 'windows-dpapi' | 'none'
  writable: boolean
  available: boolean
  refreshing: boolean
  lastSuccessAt?: number
  lastFailureAt?: number
  message: string
}

type RefreshOptions = {
  fetchFn?: typeof fetch
  timeoutMs?: number
}

type SetCookieRecord = { name: string; value: string; domain: string; path: string; expired: boolean }

@Injectable()
export class XiaomiPassportService {
  private refreshPromise?: Promise<string>
  private refreshing = false
  private lastSuccessAt?: number
  private lastFailureAt?: number

  getStatus(): XiaomiRefreshStatus {
    let source: XiaomiRefreshStatus['source'] = 'none'
    let configured = false
    try {
      source = getXiaomiPassportRefreshCredentialSource()
      configured = Boolean(getXiaomiPassportRefreshCredentials())
    } catch {
      source = 'none'
    }
    const writable = canWriteWindowsSystemSecrets() && !hasEnvironmentXiaomiPassportRefreshCredentials()
    const cookieSource = getXiaomiCloudCookieSource()
    const cookieMutable = canWriteWindowsSystemSecrets() && cookieSource !== 'environment'
    const available = configured && cookieMutable
    let message = '自动续期尚未配置'
    if (cookieSource === 'environment') message = '完整小米 Cookie 由环境变量管理，自动续期不能覆盖'
    else if (configured && cookieSource === 'none') message = 'Passport 凭证已配置，可以获取初始小米 Cookie'
    else if (available) message = '自动续期已配置，将在登录凭证失效时刷新并重试'
    else if (!configured && !writable) message = '自动续期凭证由服务端环境变量管理'
    return {
      configured,
      source,
      writable,
      available,
      refreshing: this.refreshing,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      message
    }
  }

  updateCredentials(input: XiaomiRefreshCredentialUpdate) {
    if (hasEnvironmentXiaomiPassportRefreshCredentials()) {
      throw new ConflictException('服务端环境变量已配置 Passport 凭证，页面不能覆盖')
    }
    if (!canWriteWindowsSystemSecrets()) throw new ServiceUnavailableException('当前系统不支持 Windows DPAPI 凭证保存')
    const current = getXiaomiPassportRefreshCredentials()
    const supplied = Object.fromEntries(Object.entries(input || {}).filter(([, value]) => typeof value === 'string' && value.trim())) as XiaomiRefreshCredentialUpdate
    if (!Object.keys(supplied).length) throw new BadRequestException('至少填写一个需要更新的凭证字段')
    let merged: XiaomiPassportRefreshCredentials
    try {
      merged = validateXiaomiPassportRefreshCredentials({ ...current, ...supplied })
    } catch {
      throw new BadRequestException('Passport 刷新凭证格式不正确或字段不完整')
    }
    try {
      setXiaomiPassportRefreshCredentials(merged)
      return this.getStatus()
    } catch {
      throw new ServiceUnavailableException('无法安全保存 Passport 刷新凭证，请检查 Windows 用户权限')
    }
  }

  canRefresh() {
    return this.getStatus().available
  }

  refreshCookie(currentCookie: string) {
    if (this.refreshPromise) return this.refreshPromise
    const credentials = getXiaomiPassportRefreshCredentials()
    if (!credentials) throw new ServiceUnavailableException('小米 Passport 自动续期凭证未配置')
    if (!canWriteWindowsSystemSecrets()) {
      throw new ServiceUnavailableException('当前系统不支持 Windows DPAPI Cookie 保存')
    }
    if (getXiaomiCloudCookieSource() === 'environment') {
      throw new ConflictException('完整小米 Cookie 由服务端环境变量管理，页面不能覆盖')
    }

    this.refreshing = true
    const operation = refreshICloudCookie(credentials, currentCookie)
      .then((cookie) => {
        setWindowsSystemSecret('xiaomiCloudCookie', cookie)
        this.lastSuccessAt = Date.now()
        return cookie
      })
      .catch(() => {
        this.lastFailureAt = Date.now()
        throw new ServiceUnavailableException('小米云自动续期失败，请更新 Passport 凭证')
      })
      .finally(() => {
        this.refreshing = false
        if (this.refreshPromise === operation) this.refreshPromise = undefined
      })
    this.refreshPromise = operation
    return operation
  }
}

export async function refreshICloudCookie(
  credentials: XiaomiPassportRefreshCredentials,
  currentCookie: string,
  options: RefreshOptions = {}
) {
  const normalized = validateXiaomiPassportRefreshCredentials(credentials)
  if (typeof currentCookie !== 'string' || currentCookie.length > MAX_COOKIE_LENGTH || /[\r\n\0]/.test(currentCookie)) {
    throw new Error('Current Xiaomi Cookie is invalid')
  }
  const fetchFn = options.fetchFn || globalThis.fetch
  if (typeof fetchFn !== 'function') throw new Error('Fetch is unavailable')
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const baseCookie = currentCookie.trim() || mergeCookieHeader('', INITIAL_ICLOUD_COOKIE_DEFAULTS)
  const preloginCookie = removeCookieNames(baseCookie, ['serviceToken', 'i.mi.com_slh', 'i.mi.com_ph'])

  const discoveryUrl = new URL(LOGIN_PATH, XIAOMI_ORIGIN)
  discoveryUrl.search = new URLSearchParams({
    ts: String(Date.now()),
    followUp: `${XIAOMI_ORIGIN}/?_locale=zh_CN`,
    _locale: 'zh_CN'
  }).toString()
  const discovery = await requestText(fetchFn, discoveryUrl, {
    headers: iCloudHeaders(preloginCookie)
  }, timeoutMs)
  const discoveryPayload = parseJsonObject(discovery.text)
  const loginUrlValue = discoveryPayload?.data && typeof discoveryPayload.data === 'object'
    ? (discoveryPayload.data as { loginUrl?: unknown }).loginUrl
    : undefined
  if (!discovery.response.ok || discoveryPayload?.result !== 'ok' || discoveryPayload?.code !== 0 || typeof loginUrlValue !== 'string') {
    throw new Error('Xiaomi login discovery failed')
  }
  const loginUrl = validateServiceLoginUrl(loginUrlValue)
  loginUrl.searchParams.set('_json', 'true')

  const passportCookie = buildPassportCookie(normalized)
  const initial = await requestText(fetchFn, loginUrl, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Cookie: passportCookie,
      'User-Agent': PASSPORT_USER_AGENT
    }
  }, timeoutMs)
  if (!initial.response.ok) throw new Error('Xiaomi Passport request failed')
  const passportPayload = parseJsonObject(initial.text, true)
  const ssecurity = passportPayload?.ssecurity
  const nonce = passportPayload?.nonce
  const location = passportPayload?.location
  if (typeof ssecurity !== 'string' || !ssecurity || !['string', 'number'].includes(typeof nonce) || typeof location !== 'string') {
    throw new Error('Xiaomi Passport response is incomplete')
  }
  const signedLocation = validateStsLocation(location)
  signedLocation.searchParams.set('clientSign', createClientSign(nonce as string | number, ssecurity))

  const tokenResponse = await requestText(fetchFn, signedLocation, {
    headers: iCloudHeaders(preloginCookie)
  }, timeoutMs, true)
  if (tokenResponse.response.status < 200 || tokenResponse.response.status >= 400) {
    throw new Error('Xiaomi STS request failed')
  }
  const issued = extractICloudCookies(tokenResponse.response.headers)
  const merged = mergeCookieHeader(baseCookie, issued)
  if (merged.length > MAX_COOKIE_LENGTH) throw new Error('Refreshed Xiaomi Cookie is too large')
  return merged
}

export function createClientSign(nonce: string | number, ssecurity: string) {
  return createHash('sha1').update(`nonce=${String(nonce)}&${ssecurity}`, 'utf8').digest('base64')
}

export function validateServiceLoginUrl(value: string) {
  const url = trustedUrl(value, PASSPORT_HOST, SERVICE_LOGIN_PATH)
  if (url.searchParams.get('sid') !== 'i.mi.com') throw new Error('Untrusted Xiaomi Passport sid')
  const callbackValue = url.searchParams.get('callback')
  if (!callbackValue) throw new Error('Missing Xiaomi Passport callback')
  const callback = trustedUrl(callbackValue, 'i.mi.com', STS_PATH)
  if (callback.searchParams.get('sid') !== 'i.mi.com') throw new Error('Untrusted Xiaomi callback sid')
  return url
}

export function validateStsLocation(value: string) {
  const url = trustedUrl(value, 'i.mi.com', STS_PATH)
  if (url.searchParams.get('sid') !== 'i.mi.com') throw new Error('Untrusted Xiaomi STS sid')
  return url
}

export function extractICloudCookies(headers: Headers) {
  const records = getSetCookieValues(headers).map(parseSetCookie).filter((item): item is SetCookieRecord => Boolean(item))
  const required = {
    serviceToken: selectCookie(records, 'serviceToken', '.i.mi.com'),
    userId: selectCookie(records, 'userId'),
    'i.mi.com_slh': selectCookie(records, 'i.mi.com_slh', '.i.mi.com'),
    'i.mi.com_ph': selectCookie(records, 'i.mi.com_ph', '.i.mi.com')
  }
  if (Object.values(required).some((value) => !value)) throw new Error('Xiaomi STS response is missing required cookies')
  return required as Record<string, string>
}

export function mergeCookieHeader(current: string, updates: Record<string, string>) {
  const values = new Map<string, string>()
  for (const item of current.split(';')) {
    const separator = item.indexOf('=')
    if (separator <= 0) continue
    const name = item.slice(0, separator).trim()
    const value = item.slice(separator + 1).trim()
    if (name && value) values.set(name, value)
  }
  for (const [name, value] of Object.entries(updates)) {
    if (!name || !value || /[;\r\n\0]/.test(name) || /[;\r\n\0]/.test(value)) throw new Error('Invalid refreshed Cookie value')
    values.set(name, value)
  }
  return [...values.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

function buildPassportCookie(credentials: XiaomiPassportRefreshCredentials) {
  return [
    ['passToken', credentials.passToken],
    ['userId', credentials.userId],
    ['cUserId', credentials.cUserId],
    ['deviceId', credentials.deviceId]
  ].map(([name, value]) => `${name}=${value}`).join('; ')
}

function iCloudHeaders(cookie: string) {
  return {
    Accept: 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Cookie: cookie,
    Origin: XIAOMI_ORIGIN,
    Referer: `${XIAOMI_ORIGIN}/`,
    'User-Agent': ICLOUD_USER_AGENT
  }
}

async function requestText(fetchFn: typeof fetch, url: URL, init: RequestInit, timeoutMs: number, allowRedirect = false) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, { ...init, method: 'GET', redirect: 'manual', signal: controller.signal })
    if (!allowRedirect && !response.ok) throw new Error('Xiaomi authentication request failed')
    const length = Number(response.headers.get('content-length') || 0)
    if (length > MAX_RESPONSE_BYTES) throw new Error('Xiaomi authentication response is too large')
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Xiaomi authentication response is too large')
    return { response, text }
  } catch {
    throw new Error('Xiaomi authentication request failed')
  } finally {
    clearTimeout(timer)
  }
}

function parseJsonObject(text: string, prefixed = false): Record<string, any> {
  const normalized = prefixed && text.startsWith('&&&START&&&') ? text.slice('&&&START&&&'.length) : text
  try {
    const value = JSON.parse(normalized)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object')
    return value
  } catch {
    throw new Error('Xiaomi authentication response is invalid')
  }
}

function trustedUrl(value: string, host: string, path: string) {
  let url: URL
  try { url = new URL(value) }
  catch { throw new Error('Untrusted Xiaomi authentication URL') }
  if (url.protocol !== 'https:' || url.hostname.toLocaleLowerCase('en-US') !== host || url.pathname !== path) {
    throw new Error('Untrusted Xiaomi authentication URL')
  }
  return url
}

function removeCookieNames(cookie: string, names: string[]) {
  const blocked = new Set(names)
  return cookie.split(';').map((item) => item.trim()).filter((item) => {
    const separator = item.indexOf('=')
    return separator > 0 && !blocked.has(item.slice(0, separator).trim())
  }).join('; ')
}

function getSetCookieValues(headers: Headers) {
  if (typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function') {
    return (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
  }
  const combined = headers.get('set-cookie')
  return combined ? [combined] : []
}

function parseSetCookie(value: string): SetCookieRecord | undefined {
  const parts = value.split(';').map((item) => item.trim())
  const separator = parts[0]?.indexOf('=') ?? -1
  if (separator <= 0) return undefined
  const record: SetCookieRecord = {
    name: parts[0].slice(0, separator),
    value: parts[0].slice(separator + 1),
    domain: '',
    path: '',
    expired: false
  }
  for (const attribute of parts.slice(1)) {
    const index = attribute.indexOf('=')
    const name = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLocaleLowerCase('en-US')
    const attributeValue = index < 0 ? '' : attribute.slice(index + 1).trim()
    if (name === 'domain') record.domain = attributeValue.toLocaleLowerCase('en-US')
    else if (name === 'path') record.path = attributeValue
    else if (name === 'max-age' && Number(attributeValue) <= 0) record.expired = true
    else if (name === 'expires') {
      const expiry = Date.parse(attributeValue)
      if (Number.isFinite(expiry) && expiry <= Date.now()) record.expired = true
    }
  }
  return record
}

function selectCookie(records: SetCookieRecord[], name: string, domain?: string) {
  return records.find((item) => item.name === name && !item.expired && item.value && (!domain || item.domain === domain))?.value || ''
}
