require('reflect-metadata')

const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

function main() {
  if (process.platform !== 'win32') throw new Error('Windows DPAPI is required')
  const fileArg = process.argv.find((value) => value.startsWith('--file='))
  const fileIndex = process.argv.indexOf('--file')
  const file = fileArg ? fileArg.slice('--file='.length) : fileIndex >= 0 ? process.argv[fileIndex + 1] : ''
  if (!file) throw new Error('Use --file <path-to-myinfo.txt>')

  const credentials = parseInfo(readFileSync(resolve(file), 'utf8'))
  const secrets = require('../dist/security/secrets')
  secrets.setXiaomiPassportRefreshCredentials(credentials)
  secrets.invalidateSystemSecretCache('xiaomiPassportRefreshCredentials')
  const stored = secrets.getXiaomiPassportRefreshCredentials()
  if (!stored || !sameCredentials(credentials, stored)) throw new Error('DPAPI verification failed')
  console.log(JSON.stringify({ imported: true, provider: 'windows-dpapi', fields: ['passToken', 'userId', 'cUserId', 'deviceId'], plaintextPrinted: false }, null, 2))
}

function parseInfo(text) {
  const labels = new Map([
    ['passtoken', 'passToken'],
    ['userid', 'userId'],
    ['cuserid', 'cUserId'],
    ['deviceid', 'deviceId']
  ])
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const values = {}
  for (let index = 0; index < lines.length; index += 1) {
    const label = labels.get(lines[index].replace(/[^a-z]/gi, '').toLowerCase())
    if (!label) continue
    let next = index + 1
    while (next < lines.length && !lines[next]) next += 1
    if (next < lines.length) values[label] = lines[next]
  }
  const required = ['passToken', 'userId', 'cUserId', 'deviceId']
  if (required.some((name) => typeof values[name] !== 'string' || !values[name])) throw new Error('Credential file is incomplete')
  return values
}

function sameCredentials(left, right) {
  return ['passToken', 'userId', 'cUserId', 'deviceId'].every((name) => left[name] === right[name])
}

try { main() }
catch (error) {
  console.error(error instanceof Error ? error.message : 'Import failed')
  process.exitCode = 1
}
