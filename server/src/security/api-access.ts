import { ForbiddenException, Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'node:crypto'
import { getApiToken } from './secrets'

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:1420',
  'http://127.0.0.1:1420',
  'tauri://localhost',
  'http://tauri.localhost'
]

export type ApiRequestAccessPolicy = {
  allowedOrigins: string[]
  allowRemote: boolean
  requireToken: boolean
  token: string
}

export type ApiRequestAccessFailure = { statusCode: 401 | 403; message: string }

export function getAllowedOrigins() {
  return (process.env.TERRA_ALLOWED_ORIGINS ? process.env.TERRA_ALLOWED_ORIGINS.split(',') : DEFAULT_ALLOWED_ORIGINS)
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function getApiBinding() {
  const host = (process.env.TERRA_API_HOST || '127.0.0.1').trim()
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) throw new Error('TERRA_API_HOST is invalid')
  const remote = !isLoopbackHost(host)
  const allowRemote = process.env.TERRA_ALLOW_REMOTE_API === 'true'
  const tokenConfigured = getApiToken().length >= 32
  if (remote && !allowRemote) throw new Error('Non-loopback API binding requires TERRA_ALLOW_REMOTE_API=true')
  if (remote && !tokenConfigured) throw new Error('Non-loopback API binding requires a TERRA_API_TOKEN of at least 32 characters')
  return { host, remote, allowRemote, tokenConfigured }
}

export function createApiRequestAccessPolicy(): ApiRequestAccessPolicy {
  return {
    allowedOrigins: getAllowedOrigins(),
    allowRemote: process.env.TERRA_ALLOW_REMOTE_API === 'true',
    requireToken: process.env.TERRA_REQUIRE_API_TOKEN === 'true',
    token: getApiToken()
  }
}

export function getApiRequestAccessFailure(req: any, policy: ApiRequestAccessPolicy): ApiRequestAccessFailure | undefined {
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : ''
  if (origin && !policy.allowedOrigins.includes('*') && !policy.allowedOrigins.includes(origin)) {
    return { statusCode: 403, message: 'Request origin is not allowed' }
  }
  if (!origin && req.headers?.['sec-fetch-site'] === 'cross-site' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return { statusCode: 403, message: 'Cross-site mutation request was rejected' }
  }

  const remoteAddress = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '')
  const remote = !isLoopbackAddress(remoteAddress)
  if (remote && !policy.allowRemote) return { statusCode: 403, message: 'Remote API access is disabled' }
  if ((remote || policy.requireToken) && !hasValidToken(req, policy.token)) {
    return { statusCode: 401, message: 'A valid Terra API token is required' }
  }
  return undefined
}

@Injectable()
export class ApiAccessMiddleware implements NestMiddleware {
  private readonly policy = createApiRequestAccessPolicy()

  use(req: any, res: any, next: (error?: unknown) => void) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')

    const failure = getApiRequestAccessFailure(req, this.policy)
    if (failure) {
      next(failure.statusCode === 401 ? new UnauthorizedException(failure.message) : new ForbiddenException(failure.message))
      return
    }
    next()
  }
}

export function isLoopbackHost(host: string) {
  const normalized = host.toLocaleLowerCase('en-US').replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function isLoopbackAddress(address: string) {
  const normalized = address.toLocaleLowerCase('en-US').replace(/^::ffff:/, '')
  return isLoopbackHost(normalized)
}

function hasValidToken(req: any, token: string) {
  if (token.length < 32) return false
  const authorization = typeof req.headers?.authorization === 'string' ? req.headers.authorization : ''
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  const custom = typeof req.headers?.['x-terra-api-token'] === 'string' ? req.headers['x-terra-api-token'] : ''
  const supplied = (bearer || custom).trim()
  const expectedBuffer = Buffer.from(token)
  const suppliedBuffer = Buffer.from(supplied)
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer)
}
