import { BadRequestException, BadGatewayException, GatewayTimeoutException } from '@nestjs/common'
import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

const MAX_REDIRECTS = 5
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000

export type FeedFetchResult = {
  status: 200 | 304
  body?: string
  finalUrl: string
  etag?: string
  lastModified?: string
  contentType?: string
}

export class SafeFeedFetcher {
  private readonly allowPrivateNetworks = process.env.TERRA_RSS_ALLOW_PRIVATE_NETWORKS === 'true'
  private readonly allowedPorts = new Set(
    (process.env.TERRA_RSS_ALLOWED_PORTS || '80,443')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535)
  )

  fetch(url: string, conditions: { etag?: string; lastModified?: string } = {}) {
    return this.fetchRedirect(url, conditions, 0, undefined)
  }

  private async fetchRedirect(
    rawUrl: string,
    conditions: { etag?: string; lastModified?: string },
    redirectCount: number,
    previousProtocol?: string
  ): Promise<FeedFetchResult> {
    if (redirectCount > MAX_REDIRECTS) throw new BadGatewayException('RSS redirect limit exceeded')
    const url = this.validateUrl(rawUrl)
    if (previousProtocol === 'https:' && url.protocol === 'http:') {
      throw new BadRequestException('HTTPS to HTTP feed redirects are not allowed')
    }
    const target = await this.resolvePublicAddress(url.hostname)
    const response = await this.requestPinned(url, target.address, target.family, conditions)

    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = header(response.headers.location)
      if (!location) throw new BadGatewayException('RSS redirect response is missing Location')
      return this.fetchRedirect(new URL(location, url).toString(), conditions, redirectCount + 1, url.protocol)
    }

    if (response.statusCode === 304) {
      return {
        status: 304,
        finalUrl: url.toString(),
        etag: header(response.headers.etag),
        lastModified: header(response.headers['last-modified'])
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new BadGatewayException(`RSS endpoint returned HTTP ${response.statusCode}`)
    }

    const contentType = header(response.headers['content-type'])
    if (contentType && !/(xml|rss|atom|text\/plain|text\/html)/i.test(contentType)) {
      throw new BadGatewayException(`RSS endpoint returned unsupported content type: ${contentType.slice(0, 80)}`)
    }
    const decoded = this.decodeBody(response.body, header(response.headers['content-encoding']))
    if (Buffer.byteLength(decoded, 'utf8') > MAX_RESPONSE_BYTES) throw new BadGatewayException('RSS response exceeds 2 MB')

    return {
      status: 200,
      body: decoded,
      finalUrl: url.toString(),
      etag: header(response.headers.etag),
      lastModified: header(response.headers['last-modified']),
      contentType
    }
  }

  private requestPinned(
    url: URL,
    address: string,
    family: number,
    conditions: { etag?: string; lastModified?: string }
  ): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const isHttps = url.protocol === 'https:'
      const request = (isHttps ? httpsRequest : httpRequest)({
        protocol: url.protocol,
        hostname: address,
        family,
        port: url.port ? Number(url.port) : (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        servername: isIP(url.hostname) ? undefined : url.hostname,
        rejectUnauthorized: true,
        headers: {
          Host: url.host,
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'User-Agent': 'TerraHub/0.3 RSS Reader',
          ...(conditions.etag ? { 'If-None-Match': conditions.etag } : {}),
          ...(conditions.lastModified ? { 'If-Modified-Since': conditions.lastModified } : {})
        }
      }, (response) => {
        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('RSS response exceeds 2 MB'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve({
          statusCode: response.statusCode || 502,
          headers: response.headers,
          body: Buffer.concat(chunks)
        }))
      })

      request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new GatewayTimeoutException('RSS request timed out')))
      request.on('error', (error) => {
        if (error instanceof GatewayTimeoutException) reject(error)
        else if (error.message.includes('exceeds 2 MB')) reject(new BadGatewayException(error.message))
        else reject(new BadGatewayException(`RSS network request failed: ${error.message.slice(0, 120)}`))
      })
      request.end()
    })
  }

  private validateUrl(rawUrl: string) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2_048) throw new BadRequestException('Invalid RSS URL')
    let url: URL
    try { url = new URL(rawUrl.trim()) } catch { throw new BadRequestException('Invalid RSS URL') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException('RSS URL must use HTTP or HTTPS')
    if (url.username || url.password) throw new BadRequestException('RSS URL credentials are not allowed')
    const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
    if (!this.allowedPorts.has(port)) throw new BadRequestException(`RSS port ${port} is not allowed`)
    if (!url.hostname || url.hostname.length > 253) throw new BadRequestException('Invalid RSS hostname')
    return url
  }

  private async resolvePublicAddress(hostname: string) {
    if (isIP(hostname)) {
      this.assertPublicAddress(hostname)
      return { address: hostname, family: isIP(hostname) }
    }
    let addresses: LookupAddress[]
    try { addresses = await lookup(hostname, { all: true, verbatim: true }) as LookupAddress[] } catch { throw new BadGatewayException('RSS hostname could not be resolved') }
    if (!addresses.length) throw new BadGatewayException('RSS hostname returned no addresses')
    const allowed = addresses.filter((entry) => {
      try { this.assertPublicAddress(entry.address); return true } catch { return false }
    })
    if (!allowed.length) throw new BadRequestException('RSS hostname resolves only to private or reserved addresses')
    return allowed[0]
  }

  private assertPublicAddress(address: string) {
    if (this.allowPrivateNetworks) return
    const family = isIP(address)
    if (family === 4 && isReservedIpv4(address)) throw new BadRequestException('Private or reserved RSS addresses are blocked')
    if (family === 6 && isReservedIpv6(address)) throw new BadRequestException('Private or reserved RSS addresses are blocked')
    if (!family) throw new BadRequestException('Invalid resolved RSS address')
  }

  private decodeBody(body: Buffer, encoding?: string) {
    try {
      if (/gzip/i.test(encoding || '')) return gunzipSync(body).toString('utf8')
      if (/deflate/i.test(encoding || '')) return inflateSync(body).toString('utf8')
      if (/br/i.test(encoding || '')) return brotliDecompressSync(body).toString('utf8')
      return body.toString('utf8')
    } catch {
      throw new BadGatewayException('RSS response decompression failed')
    }
  }
}

function isReservedIpv4(address: string) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  )
}

function isReservedIpv6(address: string) {
  const value = address.toLowerCase().split('%')[0]
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff')) return true
  if (value.startsWith('2001:db8')) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  return mapped ? isReservedIpv4(mapped[1]) : false
}

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
