require('reflect-metadata')

const modulePath = require.resolve('../dist/security/api-access')

function loadBinding(overrides) {
  const names = ['TERRA_API_HOST', 'TERRA_ALLOW_REMOTE_API', 'TERRA_API_TOKEN', 'TERRA_REQUIRE_API_TOKEN']
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  for (const name of names) delete process.env[name]
  Object.assign(process.env, overrides)
  delete require.cache[modulePath]
  try { return require(modulePath).getApiBinding() }
  finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
}

function expectFailure(overrides, expected) {
  try { loadBinding(overrides) }
  catch (error) {
    if (error.message.includes(expected)) return
    throw error
  }
  throw new Error(`Expected binding failure containing: ${expected}`)
}

const loopback = loadBinding({})
if (loopback.host !== '127.0.0.1' || loopback.remote) throw new Error('Default API binding is not loopback-only')
expectFailure({ TERRA_API_HOST: '0.0.0.0' }, 'TERRA_ALLOW_REMOTE_API=true')
expectFailure({ TERRA_API_HOST: '0.0.0.0', TERRA_ALLOW_REMOTE_API: 'true', TERRA_API_TOKEN: 'short' }, 'at least 32 characters')
const remote = loadBinding({ TERRA_API_HOST: '0.0.0.0', TERRA_ALLOW_REMOTE_API: 'true', TERRA_API_TOKEN: 'a'.repeat(32) })
if (!remote.remote || !remote.allowRemote || !remote.tokenConfigured) throw new Error('Explicit remote binding was not accepted')

const token = 'raw-body-access-token-value-32-characters'
const remoteRequest = { method: 'POST', headers: {}, socket: { remoteAddress: '10.0.0.12' } }
const missingRawToken = loadAccessFailure({ TERRA_ALLOW_REMOTE_API: 'true', TERRA_API_TOKEN: token }, remoteRequest)
if (missingRawToken?.statusCode !== 401) throw new Error('Large-body preflight did not reject a missing remote token')
const acceptedRawToken = loadAccessFailure({ TERRA_ALLOW_REMOTE_API: 'true', TERRA_API_TOKEN: token }, { ...remoteRequest, headers: { authorization: `Bearer ${token}` } })
if (acceptedRawToken !== undefined) throw new Error('Large-body preflight rejected a valid remote token')
const rejectedRawOrigin = loadAccessFailure({ TERRA_ALLOWED_ORIGINS: 'https://terra.example' }, { method: 'POST', headers: { origin: 'https://attacker.example' }, socket: { remoteAddress: '127.0.0.1' } })
if (rejectedRawOrigin?.statusCode !== 403) throw new Error('Large-body preflight did not reject a disallowed origin')

console.log(JSON.stringify({ defaultHost: loopback.host, remoteRejectedByDefault: true, shortTokenRejected: true, explicitRemoteAccepted: true, largeBodyPreflight: true }, null, 2))

function loadAccessFailure(overrides, request) {
  const names = ['TERRA_ALLOWED_ORIGINS', 'TERRA_ALLOW_REMOTE_API', 'TERRA_API_TOKEN', 'TERRA_REQUIRE_API_TOKEN']
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  for (const name of names) delete process.env[name]
  Object.assign(process.env, overrides)
  delete require.cache[modulePath]
  try {
    const access = require(modulePath)
    return access.getApiRequestAccessFailure(request, access.createApiRequestAccessPolicy())
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
}
