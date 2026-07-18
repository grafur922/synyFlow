const { mkdtempSync, mkdirSync, readFileSync, rmSync } = require('node:fs')
const { randomBytes, randomUUID } = require('node:crypto')
const { basename, join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')

require('reflect-metadata')

const tempRoot = resolve(mkdtempSync(join(tmpdir(), 'terra-travel-smoke-')))
const blogRoot = join(tempRoot, 'blog-content')
mkdirSync(blogRoot)

Object.assign(process.env, {
  TERRA_DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  TERRA_DATA_FILE: join(tempRoot, 'tasks.json'),
  TERRA_RESOURCE_FILE: join(tempRoot, 'resources.json'),
  TERRA_RSS_FILE: join(tempRoot, 'rss.json'),
  TERRA_BLOG_FILE: join(tempRoot, 'blog.json'),
  TERRA_BLOG_CONTENT_DIR: blogRoot,
  TERRA_TRAVEL_FILE: join(tempRoot, 'travel.json'),
  TERRA_TRAVEL_ATTACHMENTS_DB: join(tempRoot, 'travel-attachments.sqlite'),
  TERRA_RAG_FILE: join(tempRoot, 'rag.json'),
  TERRA_XIAOMI_HISTORY_FILE: join(tempRoot, 'xiaomi-history.json'),
  TERRA_XIAOMI_METADATA_FILE: join(tempRoot, 'xiaomi-metadata.json'),
  XIAOMI_COOKIE: ''
})

let app

async function main() {
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const express = require('express')

  app = await NestFactory.create(AppModule, { bodyParser: false, logger: false })
  app.use(express.raw({ limit: '64mb', type: ['application/octet-stream', 'application/vnd.terra.trip+json'] }))
  app.use(express.json({ limit: '512kb' }))
  app.setGlobalPrefix('api')
  await app.listen(0, '127.0.0.1')

  const address = app.getHttpServer().address()
  const baseUrl = `http://127.0.0.1:${address.port}/api`
  const request = createRequest(baseUrl)

  const created = await request('/travel/trips', {
    method: 'POST',
    body: {
      title: 'Shanghai Weekend',
      description: 'Museum, lake and rail planning',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
      privacy: 'private',
      tags: ['weekend', 'rail'],
      travelers: ['Terra']
    }
  })

  const dayOneId = randomUUID()
  const dayTwoId = randomUUID()
  const shanghaiId = randomUUID()
  const hangzhouId = randomUUID()
  const segmentId = randomUUID()
  const budgetCnyId = randomUUID()
  const budgetUsdId = randomUUID()

  const updated = await request(`/travel/trips/${created.id}`, {
    method: 'PATCH',
    body: {
      days: [
        {
          id: dayOneId,
          date: '2026-08-01',
          title: 'Shanghai',
          notes: '',
          places: [{ id: shanghaiId, name: 'Shanghai Museum', address: 'Shanghai', location: { latitude: 31.2304, longitude: 121.4737 }, startTime: '09:00', endTime: '12:00', notes: '' }]
        },
        {
          id: dayTwoId,
          date: '2026-08-02',
          title: 'Hangzhou',
          notes: '',
          places: [{ id: hangzhouId, name: 'West Lake', address: 'Hangzhou', location: { latitude: 30.2741, longitude: 120.1551 }, startTime: '08:00', endTime: '13:00', notes: '' }]
        }
      ],
      segments: [{
        id: segmentId,
        fromPlaceId: shanghaiId,
        toPlaceId: hangzhouId,
        fromName: 'Shanghai Museum',
        toName: 'West Lake',
        mode: 'train',
        departureAt: '2026-08-01T23:30:00+08:00',
        arrivalAt: '2026-08-02T02:00:00+08:00',
        notes: ''
      }],
      bookings: [{ id: randomUUID(), type: 'transport', title: 'Night train', provider: 'Rail', confirmation: 'LOCAL-TEST', startsAt: '2026-08-01T23:30:00+08:00', endsAt: '2026-08-02T02:00:00+08:00', cost: 120, currency: 'CNY', status: 'confirmed', notes: '' }],
      budget: [
        { id: budgetCnyId, category: 'Rail', amount: 120, currency: 'CNY', paid: true, notes: '' },
        { id: budgetUsdId, category: 'Tickets', amount: 20, currency: 'USD', paid: false, notes: '' }
      ],
      checklist: [{ id: randomUUID(), text: 'Pack ID', completed: true, category: 'documents' }]
    }
  })

  const providers = await request('/travel/map/providers')
  assert(providers.length === 4 && providers.find((provider) => provider.id === 'amap')?.routeLinks === false, 'map provider capabilities are incorrect')
  assert(providers.find((provider) => provider.id === 'osm')?.routeModes.join(',') === 'walk,bike,drive', 'map provider route modes are incomplete')
  const mapLink = await request('/travel/map/link', {
    method: 'POST',
    body: { provider: 'osm', kind: 'place', target: { name: 'West Lake', address: 'Hangzhou', location: { latitude: 30.2741, longitude: 120.1551 } } }
  })
  assert(mapLink.url.startsWith('https://www.openstreetmap.org/') && mapLink.externalRequestOnOpen === true, 'map adapter did not return a privacy-labelled HTTPS link')
  await expectStatus(request, '/travel/map/link', 400, { method: 'POST', body: { provider: 'amap', kind: 'route', origin: { name: 'A' }, destination: { name: 'B' } } })
  await expectStatus(request, '/travel/map/link', 400, { method: 'POST', body: { provider: 'osm', kind: 'route', origin: { name: 'A', location: { latitude: 31, longitude: 121 } }, destination: { name: 'B', location: { latitude: 30, longitude: 120 } }, mode: 'train' } })
  const trainMapLink = await request('/travel/map/link', { method: 'POST', body: { provider: 'google', kind: 'route', origin: { name: 'A' }, destination: { name: 'B' }, mode: 'train' } })
  assert(trainMapLink.url.startsWith('https://www.google.com/maps/dir/') && trainMapLink.url.includes('travelmode=transit'), 'supported train route mode was not mapped correctly')

  const attachmentBody = Buffer.from('PRIVATE-BOARDING-PASS-CONTENT', 'utf8')
  const attachmentUpload = await request(`/travel/trips/${created.id}/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Terra-Attachment-Name': encodeURIComponent('boarding-pass.txt'),
      'X-Terra-Attachment-Mime': encodeURIComponent('text/plain'),
      'X-Terra-Attachment-Scope': 'booking',
      'X-Terra-Attachment-Scope-Id': updated.bookings[0].id
    },
    rawBody: attachmentBody
  })
  assert(attachmentUpload.attachment.size === attachmentBody.length && attachmentUpload.trip.attachments.length === 1, 'encrypted attachment upload failed')
  const attachmentDownload = await request(`/travel/trips/${created.id}/attachments/${attachmentUpload.attachment.id}`, { rawResponse: true })
  assert(attachmentDownload.body.equals(attachmentBody) && attachmentDownload.headers.get('content-type') === 'application/octet-stream', 'attachment download did not reproduce the original body')
  await expectStatus(request, `/travel/trips/${created.id}`, 400, { method: 'PATCH', body: { attachments: [] } })

  const { ResourcesService } = require('../dist/resources/resources.service')
  const { XiaomiNoteMetadataService } = require('../dist/xiaomi-notes/xiaomi-note-metadata.service')
  const resourcesService = app.get(ResourcesService)
  const noteMetadataService = app.get(XiaomiNoteMetadataService)
  await resourcesService.replaceSourceResources('rss', 'rss_item', [candidateResource('rss', 'rss_item', 'rss-candidate', 'Suzhou Garden Guide', 'private', true)])
  await resourcesService.replaceSourceResources('xiaomi', 'note', [candidateResource('xiaomi', 'note', '50993292568436800', 'Secret Hangzhou Notes', 'private', false)])
  await noteMetadataService.update('50993292568436800', { favorite: true, privacy: 'secret' })

  const defaultImport = await request('/travel/candidates/import-favorites', { method: 'POST' })
  assert(defaultImport.eligible === 1 && defaultImport.imported === 1, 'default candidate import did not exclude secret favorites')
  const repeatedImport = await request('/travel/candidates/import-favorites', { method: 'POST' })
  assert(repeatedImport.imported === 0 && repeatedImport.unchanged === 1, 'candidate import is not idempotent')
  let candidates = await request('/travel/candidates')
  const rssCandidate = candidates.find((candidate) => candidate.source === 'rss')
  assert(rssCandidate && rssCandidate.placeName === 'Suzhou Garden', 'RSS favorite did not become a location candidate')
  const addedCandidate = await request(`/travel/candidates/${rssCandidate.id}/add-to-trip`, {
    method: 'POST',
    body: { tripId: created.id, dayId: dayOneId }
  })
  assert(addedCandidate.candidate.status === 'added' && addedCandidate.place.name === 'Suzhou Garden', 'candidate was not added to the selected trip day')
  await expectStatus(request, `/travel/candidates/${rssCandidate.id}/add-to-trip`, 409, { method: 'POST', body: { tripId: created.id, dayId: dayOneId } })

  const secretImport = await request('/travel/candidates/import-favorites?maxPrivacy=secret', { method: 'POST' })
  assert(secretImport.imported === 1, 'explicit secret candidate import failed')
  candidates = await request('/travel/candidates?source=xiaomi')
  assert(candidates.length === 1 && candidates[0].privacy === 'secret', 'secret Xiaomi candidate classification was lost')
  await expectStatus(request, `/travel/candidates/${candidates[0].id}/add-to-trip`, 400, { method: 'POST', body: { tripId: created.id, dayId: dayOneId } })

  const summary = await request(`/travel/trips/${created.id}/summary`)
  assert(summary.days === 2 && summary.places === 3 && summary.bookings === 1, 'summary counts are incorrect')
  assert(summary.totalDistanceKm > 100 && summary.totalDurationMinutes === 150, 'distance or duration was not computed')
  assert(summary.budgetByCurrency.CNY.total === 120 && summary.budgetByCurrency.USD.unpaid === 20, 'multi-currency budget summary is incorrect')

  const markdown = await request(`/travel/trips/${created.id}/export?format=markdown`)
  const jsonExport = await request(`/travel/trips/${created.id}/export?format=json`)
  assert(markdown.content.includes('# Shanghai Weekend') && markdown.content.includes('Shanghai Museum'), 'Markdown export is incomplete')
  assert(JSON.parse(jsonExport.content).id === created.id, 'JSON export is invalid')

  const search = await request('/resources/search?q=Shanghai%20Museum&type=trip')
  assert(search.some((item) => item.sourceId === created.id), 'trip was not added to the Resource index')
  const contextualSearch = await request('/resources/search?q=Shanghai%20Museum&type=trip&source=travel&tag=weekend&project=Shanghai%20Weekend&location=Shanghai&fromDate=2026-08-02&toDate=2026-08-02')
  const contextualTrip = contextualSearch.find((item) => item.sourceId === created.id)
  assert(contextualTrip && contextualTrip.context.time.timezone === 'Asia/Shanghai' && contextualTrip.context.locations.some((item) => item.name === 'Shanghai Museum'), 'trip Resource context or filters are incomplete')

  const duplicate = await request(`/travel/trips/${created.id}/duplicate`, { method: 'POST' })
  const duplicatePlaceIds = new Set(duplicate.days.flatMap((day) => day.places.map((place) => place.id)))
  assert(duplicate.id !== created.id, 'duplicate reused the trip ID')
  assert(duplicate.segments[0].fromPlaceId !== updated.segments[0].fromPlaceId, 'duplicate reused a source place ID')
  assert(duplicatePlaceIds.has(duplicate.segments[0].fromPlaceId) && duplicatePlaceIds.has(duplicate.segments[0].toPlaceId), 'duplicate segment references were not remapped')
  assert(duplicate.attachments.length === 1 && duplicate.attachments[0].id !== attachmentUpload.attachment.id && duplicate.attachments[0].scopeId === duplicate.bookings[0].id, 'duplicate attachment body or scope was not remapped')
  const duplicateAttachment = await request(`/travel/trips/${duplicate.id}/attachments/${duplicate.attachments[0].id}`, { rawResponse: true })
  assert(duplicateAttachment.body.equals(attachmentBody), 'duplicate attachment body is incomplete')

  const packagePassphrase = 'offline-package-passphrase-32'
  const offlinePackage = await request(`/travel/trips/${created.id}/offline-package`, {
    method: 'POST',
    body: { passphrase: packagePassphrase },
    rawResponse: true
  })
  assert(!offlinePackage.body.toString('utf8').includes('Shanghai Weekend') && !offlinePackage.body.toString('utf8').includes('PRIVATE-BOARDING'), 'offline package leaked plaintext')
  await expectStatus(request, '/travel/offline-packages/import', 400, {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.terra.trip+json', 'X-Terra-Package-Passphrase': encodeURIComponent('wrong-package-passphrase-32') },
    rawBody: offlinePackage.body
  })
  const imported = await request('/travel/offline-packages/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.terra.trip+json', 'X-Terra-Package-Passphrase': encodeURIComponent(packagePassphrase) },
    rawBody: offlinePackage.body
  })
  assert(imported.id !== created.id && imported.attachments.length === 1 && imported.attachments[0].id !== attachmentUpload.attachment.id, 'offline package import did not rebuild private identifiers')
  const importedAttachment = await request(`/travel/trips/${imported.id}/attachments/${imported.attachments[0].id}`, { rawResponse: true })
  assert(importedAttachment.body.equals(attachmentBody), 'offline package attachment did not round trip')

  await expectStatus(request, '/travel/trips', 400, { method: 'POST', body: { title: 'Bad date', description: '', startDate: '2026-02-30', endDate: '2026-03-01', timezone: 'UTC', currency: 'CNY', privacy: 'private', tags: [], travelers: [] } })
  await expectStatus(request, '/travel/trips', 400, { method: 'POST', body: { title: 'Bad zone', description: '', startDate: '2026-03-01', endDate: '2026-03-02', timezone: 'Mars/Olympus', currency: 'CNY', privacy: 'private', tags: [], travelers: [] } })
  await expectStatus(request, `/travel/trips/${created.id}`, 400, { method: 'PATCH', body: { segments: [{ ...updated.segments[0], departureAt: '2026-08-02T03:00:00+08:00', arrivalAt: '2026-08-02T02:00:00+08:00' }] } })
  await expectStatus(request, `/travel/trips/${created.id}`, 400, { method: 'PATCH', body: { budget: [{ id: budgetCnyId, category: 'A', amount: 1, currency: 'CNY', paid: false, notes: '' }, { id: budgetCnyId, category: 'B', amount: 2, currency: 'CNY', paid: false, notes: '' }] } })
  await expectStatus(request, `/travel/trips/${created.id}/export?format=csv`, 400)

  const travelEnvelope = JSON.parse(readFileSync(process.env.TERRA_TRAVEL_FILE, 'utf8'))
  const resourceEnvelope = JSON.parse(readFileSync(process.env.TERRA_RESOURCE_FILE, 'utf8'))
  const travelRaw = readFileSync(process.env.TERRA_TRAVEL_FILE, 'utf8')
  const attachmentRaw = readFileSync(process.env.TERRA_TRAVEL_ATTACHMENTS_DB)
  assert(travelEnvelope.format === 'terra-travel-state' && resourceEnvelope.format === 'terra-resource-index', 'encrypted store envelope format is incorrect')
  assert(!travelRaw.includes('Shanghai Weekend') && !travelRaw.includes('LOCAL-TEST') && !travelRaw.includes('Suzhou Garden') && !travelRaw.includes('Secret Hangzhou Notes'), 'plaintext travel or candidate data leaked to disk')
  assert(!attachmentRaw.includes(attachmentBody) && !attachmentRaw.includes(Buffer.from('boarding-pass.txt')), 'attachment body or filename leaked to SQLite')

  await request(`/travel/trips/${created.id}/attachments/${attachmentUpload.attachment.id}`, { method: 'DELETE' })
  await expectStatus(request, `/travel/trips/${created.id}/attachments/${attachmentUpload.attachment.id}`, 404)
  await request(`/travel/trips/${imported.id}`, { method: 'DELETE' })
  await request(`/travel/trips/${duplicate.id}`, { method: 'DELETE' })
  const finalStatus = await request('/travel/status')
  assert(finalStatus.attachmentCount === 0 && finalStatus.attachmentBytes === 0, 'trip or attachment deletion left encrypted orphan rows')
  const attachmentDatabaseBeforeWrongKey = readFileSync(process.env.TERRA_TRAVEL_ATTACHMENTS_DB)
  const wrongKeyProbe = spawnSync(process.execPath, ['-e', `
    require('reflect-metadata');
    const { TravelAttachmentStore } = require('./dist/travel/travel-attachment.store');
    (async () => {
      const store = new TravelAttachmentStore();
      const status = await store.getStatus();
      await store.onModuleDestroy();
      if (status.available || !status.message.includes('key')) process.exit(2);
    })().catch(() => process.exit(3));
  `], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, TERRA_DATA_ENCRYPTION_KEY: 'wrong-travel-attachment-key-32' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000
  })
  assert(wrongKeyProbe.status === 0, `wrong attachment key probe failed: ${wrongKeyProbe.stderr}`)
  assert(readFileSync(process.env.TERRA_TRAVEL_ATTACHMENTS_DB).equals(attachmentDatabaseBeforeWrongKey), 'wrong attachment key modified the existing database')

  console.log(JSON.stringify({
    tripId: created.id,
    distanceKm: summary.totalDistanceKm,
    durationMinutes: summary.totalDurationMinutes,
    resourceMatches: search.length,
    contextualResourceFilter: true,
    favoriteCandidatesImported: 2,
    candidateImportIdempotent: true,
    candidateAddedToTrip: true,
    candidatePrivacyBoundary: true,
    duplicateReferencesRemapped: true,
    mapProviderBoundary: true,
    encryptedAttachments: true,
    offlinePackageRoundTrip: true,
    attachmentOrphansRemoved: true,
    wrongAttachmentKeyProtected: true,
    invalidDate: 400,
    invalidTimezone: 400,
    reversedSegment: 400,
    duplicateNestedId: 400,
    invalidExport: 400,
    encryptedAtRest: true
  }, null, 2))
}

function createRequest(baseUrl) {
  return async (path, options = {}) => {
    const headers = new Headers(options.headers)
    if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.rawBody === undefined ? options.body === undefined ? undefined : JSON.stringify(options.body) : options.rawBody
    })
    const raw = Buffer.from(await response.arrayBuffer())
    const text = raw.toString('utf8')
    let body
    try { body = text ? JSON.parse(text) : undefined } catch { body = text }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
      error.status = response.status
      throw error
    }
    if (options.rawResponse) return { body: raw, headers: response.headers, status: response.status }
    return body
  }
}

function candidateResource(source, type, sourceId, title, privacy, favorite) {
  const id = `${source}:${type}:${sourceId}`
  return {
    id,
    type,
    source,
    sourceId,
    title,
    summary: `${title} summary`,
    content: `${title} private body`,
    tags: ['travel-guide'],
    privacy,
    context: {
      projects: ['Travel research'],
      time: { startAt: 100, endAt: 200 },
      locations: source === 'rss' ? [{ name: 'Suzhou Garden', address: 'Suzhou', latitude: 31.324, longitude: 120.629 }] : []
    },
    archived: false,
    deleted: false,
    createdAt: 100,
    updatedAt: 200,
    indexedAt: 300,
    metadata: { favorite, link: source === 'rss' ? 'https://example.test/suzhou' : undefined }
  }
}

async function expectStatus(request, path, status, options) {
  try {
    await request(path, options)
  } catch (error) {
    if (error.status === status) return
    throw error
  }
  throw new Error(`Expected HTTP ${status} for ${path}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function cleanup() {
  const tempBase = resolve(tmpdir())
  if (!tempRoot.startsWith(`${tempBase}\\`) && !tempRoot.startsWith(`${tempBase}/`)) return
  if (!basename(tempRoot).startsWith('terra-travel-smoke-')) return
  rmSync(tempRoot, { recursive: true, force: true })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (app) await app.close()
    cleanup()
  })
