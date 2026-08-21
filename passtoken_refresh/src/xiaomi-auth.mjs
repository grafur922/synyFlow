import { createHash } from 'node:crypto';

export function parseServiceLoginResponse(responseText) {
  const jsonText = responseText.startsWith('&&&START&&&')
    ? responseText.slice('&&&START&&&'.length)
    : responseText;

  try {
    const payload = JSON.parse(jsonText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('not an object');
    }
    return payload;
  } catch {
    throw new Error('serviceLogin 响应格式无效');
  }
}

export function createClientSign(nonce, ssecurity) {
  return createHash('sha1')
    .update(`nonce=${String(nonce)}&${ssecurity}`, 'utf8')
    .digest('base64');
}

export function assertTrustedLocation(location) {
  let parsed;
  try {
    parsed = new URL(location);
  } catch {
    throw new Error('serviceLogin 返回了不可信的跳转地址');
  }

  const hostname = parsed.hostname.toLowerCase();
  const trustedHost = hostname.endsWith('.xiaomi.com') || hostname.endsWith('.mi.com');
  if (parsed.protocol !== 'https:' || !trustedHost) {
    throw new Error('serviceLogin 返回了不可信的跳转地址');
  }
  return parsed;
}

function getSetCookieValues(headers) {
  if (typeof headers?.getSetCookie === 'function') {
    return headers.getSetCookie() ?? [];
  }

  const combined = headers?.get?.('set-cookie');
  return combined ? [combined] : [];
}

export function extractServiceToken(headers) {
  for (const cookieHeader of getSetCookieValues(headers)) {
    const match = /(?:^|[,;]\s*)serviceToken=(?:"([^"]*)"|([^;,]*))/u.exec(cookieHeader);
    const token = match?.[1] ?? match?.[2];
    if (token) {
      return token.trim();
    }
  }
  return null;
}

const PASSPORT_URL = 'https://account.xiaomi.com/pass/serviceLogin';
const AUTH_DEVICE_ID = 'android_96881c8a-b3aa-484c-83fb-230385b91dbc';
const DEFAULT_TIMEOUT_MS = 30_000;
const PASSPORT_USER_AGENT =
  'Dalvik/2.1.0 (Linux; U; Android 15; PKG110 Build/UKQ1.231108.001) APP/xiaomi.mico APPV/2004059 MK/UEtHMTEw SDKV/5.2.0.release.32 PassportSDK/5.2.0.release.39 CPN/com.xiaomi.mico passport-ui/5.2.0.release.39 DB/Secure';

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} 配置不能为空`);
  }
  return value;
}

function validateCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('认证配置无效');
  }
  return {
    miUserId: requireString(credentials.miUserId, 'MI_USER_ID'),
    cUserId: requireString(credentials.cUserId, 'C_USER_ID'),
    passToken: requireString(credentials.passToken, 'PASS_TOKEN'),
  };
}

function buildCookieHeader(credentials) {
  const values = {
    passToken: credentials.passToken,
    userId: credentials.miUserId,
    cUserId: credentials.cUserId,
    deviceId: AUTH_DEVICE_ID,
  };

  return Object.entries(values)
    .map(([name, value]) => {
      if (/[,;\r\n]/u.test(value)) {
        throw new Error(`${name} 配置包含非法字符`);
      }
      return `${name}=${value}`;
    })
    .join('; ');
}

async function request(fetchFn, url, headers, timeoutMs, { allowRedirect = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    const isRedirect = response.status >= 300 && response.status < 400;
    if (typeof response.ok === 'boolean' && !response.ok && !(allowRedirect && isRedirect)) {
      throw new Error('upstream request failed');
    }
    return response;
  } catch {
    throw new Error('Xiaomi Passport 请求失败');
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshMicoapiServiceToken(credentials, options = {}) {
  const validated = validateCredentials(credentials);
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof fetchFn !== 'function') {
    throw new Error('当前 Node.js 环境不支持 fetch');
  }

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': PASSPORT_USER_AGENT,
    Cookie: buildCookieHeader(validated),
  };
  const loginUrl = new URL(PASSPORT_URL);
  loginUrl.search = new URLSearchParams({
    _json: 'true',
    appName: 'com.xiaomi.mico',
    sid: 'micoapi',
    _locale: 'zh_CN',
  }).toString();

  const initialResponse = await request(fetchFn, loginUrl, headers, timeoutMs);
  let initialPayload;
  try {
    initialPayload = parseServiceLoginResponse(await initialResponse.text());
  } catch (error) {
    if (error.message === 'serviceLogin 响应格式无效') {
      throw error;
    }
    throw new Error('Xiaomi Passport 初始响应读取失败');
  }

  const { ssecurity, location, nonce } = initialPayload;
  if (!ssecurity || !location || !nonce) {
    throw new Error('Xiaomi Passport 初始响应缺少认证字段');
  }

  const signedLocation = assertTrustedLocation(location);
  signedLocation.searchParams.set('clientSign', createClientSign(nonce, ssecurity));
  const tokenResponse = await request(fetchFn, signedLocation, headers, timeoutMs, {
    allowRedirect: true,
  });
  const serviceToken = extractServiceToken(tokenResponse.headers);
  if (!serviceToken) {
    throw new Error('Xiaomi Passport 未返回 serviceToken');
  }
  return serviceToken;
}
