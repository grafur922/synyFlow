const { refreshICloudCookie, validateServiceLoginUrl, validateStsLocation, mergeCookieHeader, createClientSign } = require('../dist/xiaomi-notes/xiaomi-passport.service')

async function main() {
  const credentials = { passToken: 'pass-token-test', userId: '10001', cUserId: 'c-user-test', deviceId: 'device-test' }
  const calls = []
  const responses = [
    fakeResponse(200, JSON.stringify({ result: 'ok', code: 0, data: { loginUrl: 'https://account.xiaomi.com/pass/serviceLogin?_group=DEFAULT&_locale=zh_CN&sid=i.mi.com&callback=https%3A%2F%2Fi.mi.com%2Fsts%3Fsid%3Di.mi.com' } })),
    fakeResponse(200, '&&&START&&&' + JSON.stringify({ ssecurity: 'ssecurity-test', nonce: 12345, location: 'https://i.mi.com/sts?sid=i.mi.com' })),
    fakeResponse(302, '', [
      'serviceToken=refreshed-service-token; Domain=.i.mi.com; Path=/; Secure',
      'userId=10001; Domain=.mi.com; Path=/',
      'i.mi.com_slh=refreshed-slh; Domain=.i.mi.com; Path=/',
      'i.mi.com_ph=refreshed-ph; Domain=.i.mi.com; Path=/',
      'i.mi.com_slh=; Domain=.mi.com; Path=/; Expires=Thu, 01-Dec-1994 16:00:00 GMT'
    ])
  ]
  let index = 0
  const cookie = 'xmuuid=x; mstuid=m; uLocale=zh_CN; i.mi.com_isvalid_servicetoken=true; serviceToken=old-token; i.mi.com_slh=old-slh; i.mi.com_ph=old-ph'
  const result = await refreshICloudCookie(credentials, cookie, {
    fetchFn: async (url, init) => {
      calls.push({ url: new URL(url).toString(), cookie: new Headers(init.headers).get('Cookie') || '' })
      return responses[index++]
    }
  })
  assert(result.includes('serviceToken=refreshed-service-token'), 'refreshed serviceToken missing')
  assert(result.includes('i.mi.com_slh=refreshed-slh') && result.includes('i.mi.com_ph=refreshed-ph'), 'STS cookies missing')
  assert(result.includes('xmuuid=x') && result.includes('i.mi.com_isvalid_servicetoken=true'), 'existing Cookie values were not preserved')
  assert(calls.length === 3 && calls[0].url.includes('/api/user/login') && calls[1].url.includes('account.xiaomi.com/pass/serviceLogin') && calls[2].url.includes('/sts'), 'refresh request sequence is incorrect')
  assert(!calls[2].cookie.includes('passToken='), 'passToken was sent to i.mi.com STS')
  const initialCookieResponses = [
    fakeResponse(200, JSON.stringify({ result: 'ok', code: 0, data: { loginUrl: 'https://account.xiaomi.com/pass/serviceLogin?sid=i.mi.com&callback=https%3A%2F%2Fi.mi.com%2Fsts%3Fsid%3Di.mi.com' } })),
    fakeResponse(200, '&&&START&&&' + JSON.stringify({ ssecurity: 'initial-security', nonce: 7, location: 'https://i.mi.com/sts?sid=i.mi.com' })),
    fakeResponse(302, '', [
      'serviceToken=initial-service-token; Domain=.i.mi.com; Path=/; Secure',
      'userId=10001; Domain=.mi.com; Path=/',
      'i.mi.com_slh=initial-slh; Domain=.i.mi.com; Path=/',
      'i.mi.com_ph=initial-ph; Domain=.i.mi.com; Path=/'
    ])
  ]
  let initialCookieIndex = 0
  const initialCookie = await refreshICloudCookie(credentials, '', {
    fetchFn: async () => initialCookieResponses[initialCookieIndex++]
  })
  assert(initialCookie.includes('serviceToken=initial-service-token') && initialCookie.includes('userId=10001'), 'initial Cookie is missing STS values')
  assert(initialCookie.includes('uLocale=zh_CN') && initialCookie.includes('iplocale=zh_CN'), 'initial Cookie is missing locale defaults')
  assert(initialCookie.includes('i.mi.com_isvalid_servicetoken=true') && initialCookie.includes('i.mi.com_istrudev=true'), 'initial Cookie is missing i.mi.com defaults')
  assert(createClientSign(12345, 'ssecurity-test') === 'eAY+IoS7F1FLDk1FbHzd2kkTYiA=', 'clientSign regression')
  assert(validateServiceLoginUrl('https://account.xiaomi.com/pass/serviceLogin?sid=i.mi.com&callback=https%3A%2F%2Fi.mi.com%2Fsts%3Fsid%3Di.mi.com').hostname === 'account.xiaomi.com', 'trusted login URL rejected')
  assert(validateStsLocation('https://i.mi.com/sts?sid=i.mi.com').pathname === '/sts', 'trusted STS URL rejected')
  await expectThrow(() => validateServiceLoginUrl('https://evil.example/pass/serviceLogin?sid=i.mi.com&callback=https%3A%2F%2Fi.mi.com%2Fsts%3Fsid%3Di.mi.com'))
  await expectThrow(() => validateStsLocation('https://i.mi.com/other?sid=i.mi.com'))
  assert(mergeCookieHeader('a=1; b=2', { b: '3', c: '4' }) === 'a=1; b=3; c=4', 'Cookie merge regression')
  console.log(JSON.stringify({ discoveredLoginUrl: true, sidBoundary: true, clientSign: true, stsCookieExtraction: true, cookieMerge: true, initialCookieCreation: true, passportSecretNotSentToSts: true, untrustedRedirectBlocked: true }, null, 2))
}
function fakeResponse(status, body, setCookies = []) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(body)) : null,
      getSetCookie: () => setCookies
    },
    text: async () => body
  }
}
async function expectThrow(work) {
  try { await work() } catch { return }
  throw new Error('Expected rejection')
}
function assert(condition, message) { if (!condition) throw new Error(message) }
main().catch((error) => { console.error(error.message); process.exitCode = 1 })

