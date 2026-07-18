import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { createApiRequestAccessPolicy, getAllowedOrigins, getApiBinding, getApiRequestAccessFailure } from './security/api-access'

function loadLocalEnv() {
  try {
    const content = readFileSync(join(process.cwd(), '.env'), 'utf8')
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const separator = line.indexOf('=')
      if (separator <= 0) continue
      const key = line.slice(0, separator).trim()
      let value = line.slice(separator + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && process.env[key] === undefined) process.env[key] = value
    }
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      console.warn('Failed to read server/.env', error)
    }
  }
}

async function bootstrap() {
  loadLocalEnv()
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  const express = require('express') as {
    raw: (options: { limit: string; type: string[] }) => any
    json: (options: { limit: string }) => any
    urlencoded: (options: { limit: string; extended: boolean }) => any
  }
  const allowedOrigins = getAllowedOrigins()
  const largeBodyPolicy = createApiRequestAccessPolicy()
  app.use((req: any, res: any, next: (cause?: unknown) => void) => {
    const contentType = String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/octet-stream' && contentType !== 'application/vnd.terra.trip+json') {
      next()
      return
    }
    const failure = getApiRequestAccessFailure(req, largeBodyPolicy)
    if (!failure) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.status(failure.statusCode).json({ statusCode: failure.statusCode, message: failure.message })
  })
  app.use(express.raw({ limit: '64mb', type: ['application/octet-stream', 'application/vnd.terra.trip+json'] }))
  app.use(express.json({ limit: '512kb' }))
  app.use(express.urlencoded({ limit: '512kb', extended: true }))
  const port = Number(process.env.PORT ?? process.env.TERRA_API_PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('API port is invalid')
  const binding = getApiBinding()

  app.setGlobalPrefix('api')
  app.enableCors({
    credentials: true,
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false)
    }
  })

  await app.listen(port, binding.host)
}

void bootstrap()
