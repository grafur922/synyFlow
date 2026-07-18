import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ResourcesService } from '../resources/resources.service'
import type { Resource } from '../resources/resource.model'
import { EncryptedJsonStore } from '../storage/encrypted-json.store'
import { getDataEncryptionSecret } from '../security/secrets'
import type {
  CreateTripInput,
  CreateTripAttachmentInput,
  GeoPoint,
  TripAttachment,
  TravelMode,
  TravelCandidate,
  TravelCandidateStatus,
  TravelAttachmentScope,
  TravelPrivacy,
  TravelState,
  Trip,
  TripBooking,
  TripBudgetItem,
  TripChecklistItem,
  TripDay,
  TripPlace,
  TripSegment,
  TripStatus,
  UpdateTripInput,
  UpdateTravelCandidateInput
} from './travel.model'
import { TravelAttachmentStore, TRAVEL_ATTACHMENT_LIMITS } from './travel-attachment.store'
import {
  decryptTravelOfflinePackage,
  encryptTravelOfflinePackage,
  type TravelOfflinePackagePayload
} from './travel-offline-package'

const MAX_TRIPS = 1_000
const MAX_CANDIDATES = 5_000
const MAX_DAYS = 366
const MAX_NESTED_ITEMS = 10_000
const MAX_TRIP_JSON_PACKAGE_BYTES = 8 * 1024 * 1024
const STATUSES = new Set<TripStatus>(['planning', 'active', 'completed', 'archived'])
const PRIVACY = new Set<TravelPrivacy>(['public', 'private', 'secret'])
const MODES = new Set<TravelMode>(['walk', 'bike', 'drive', 'transit', 'train', 'flight', 'ferry', 'other'])
const CANDIDATE_STATUSES = new Set<TravelCandidateStatus>(['inbox', 'saved', 'added', 'dismissed'])

@Injectable()
export class TravelService {
  private readonly store: EncryptedJsonStore<TravelState>
  private readonly attachmentInitialization: Promise<void>
  private resourceSyncError = ''
  private attachmentCleanupError = ''

  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly attachmentStore: TravelAttachmentStore
  ) {
    const encryptionSecret = getDataEncryptionSecret()
    this.store = new EncryptedJsonStore<TravelState>({
      filePath: process.env.TERRA_TRAVEL_FILE || join(process.cwd(), 'data', 'travel.json'),
      encryptionSecret,
      encryptedFormat: 'terra-travel-state',
      defaultValue: () => ({ trips: [], candidates: [] }),
      validate: (value): value is TravelState => this.isState(value),
      maxPlaintextBytes: 128 * 1024 * 1024
    })
    this.attachmentInitialization = this.initializeAttachmentReferences()
  }

  async getStatus() {
    await this.attachmentInitialization
    const [state, attachmentStatus] = await Promise.all([this.store.read(), this.attachmentStore.getStatus()])
    return {
      ...this.store.getStatus(),
      tripCount: state.trips.length,
      candidateCount: state.candidates?.length || 0,
      attachmentCount: attachmentStatus.count,
      attachmentBytes: attachmentStatus.bytes,
      attachmentStoreAvailable: attachmentStatus.available && !this.attachmentCleanupError,
      attachmentStoreMessage: this.attachmentCleanupError || attachmentStatus.message,
      resourceSyncError: this.resourceSyncError || undefined
    }
  }

  async findAll() {
    const state = await this.store.read()
    return state.trips.map((source) => {
      const hydrated = this.hydrateTrip(source)
      const { days, segments, bookings, budget, checklist, attachments, ...trip } = hydrated
      return {
        ...trip,
        dayCount: days.length,
        segmentCount: segments.length,
        bookingCount: bookings.length,
        attachmentCount: attachments.length,
        attachmentBytes: attachments.reduce((sum, item) => sum + item.size, 0),
        budgetSummary: this.summarizeBudget(budget),
        checklistCompleted: checklist.filter((item) => item.completed).length,
        checklistTotal: checklist.length
      }
    }).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async findOne(id: string) {
    const state = await this.store.read()
    return this.hydrateTrip(this.requireTrip(state, id))
  }

  async findCandidates(options: { status?: string; source?: string } = {}) {
    const state = await this.store.read()
    const status = options.status ? this.normalizeCandidateStatus(options.status) : undefined
    const source = options.source ? this.normalizeCandidateSource(options.source) : undefined
    return [...(state.candidates || [])]
      .filter((candidate) => !status || candidate.status === status)
      .filter((candidate) => !source || candidate.source === source)
      .sort((a, b) => Number(b.status === 'inbox') - Number(a.status === 'inbox') || b.updatedAt - a.updatedAt)
  }

  async importFavoriteCandidates(maxPrivacy = 'private') {
    const resources = await this.resourcesService.findFavoriteTravelResources(maxPrivacy)
    const now = Date.now()
    let imported = 0
    let refreshed = 0
    await this.store.update((state) => {
      const candidates = this.candidatesOf(state)
      const byResourceId = new Map(candidates.map((candidate) => [candidate.sourceResourceId, candidate]))
      for (const resource of resources) {
        const existing = byResourceId.get(resource.id)
        if (existing) {
          if (resource.updatedAt > existing.sourceUpdatedAt) {
            existing.tags = [...resource.tags]
            existing.privacy = resource.privacy
            existing.sourceUrl = this.sourceUrlFromResource(resource.metadata.link)
            existing.sourceUpdatedAt = resource.updatedAt
            existing.updatedAt = now
            refreshed += 1
          }
          continue
        }
        if (candidates.length >= MAX_CANDIDATES) throw new BadRequestException('Travel candidate limit reached')
        const location = resource.context.locations[0]
        const candidate: TravelCandidate = {
          id: randomUUID(),
          sourceResourceId: resource.id,
          source: resource.source as 'xiaomi' | 'rss',
          sourceId: resource.sourceId,
          title: (resource.title || '未命名候选').slice(0, 300),
          summary: resource.summary.slice(0, 2_000),
          sourceUrl: this.sourceUrlFromResource(resource.metadata.link),
          tags: [...resource.tags].slice(0, 20),
          privacy: resource.privacy,
          status: 'inbox',
          placeName: (location?.name || resource.title).slice(0, 300),
          address: (location?.address || '').slice(0, 500),
          location: location?.latitude !== undefined && location.longitude !== undefined
            ? { latitude: location.latitude, longitude: location.longitude }
            : undefined,
          notes: '',
          sourceUpdatedAt: resource.updatedAt,
          createdAt: now,
          updatedAt: now
        }
        candidates.push(candidate)
        byResourceId.set(resource.id, candidate)
        imported += 1
      }
    })
    return { eligible: resources.length, imported, refreshed, unchanged: resources.length - imported - refreshed }
  }

  async updateCandidate(id: string, input: UpdateTravelCandidateInput) {
    const safeId = this.assertUuid(id)
    let updated!: TravelCandidate
    await this.store.update((state) => {
      const candidates = this.candidatesOf(state)
      const index = candidates.findIndex((candidate) => candidate.id === safeId)
      if (index < 0) throw new NotFoundException('Travel candidate was not found')
      const current = candidates[index]
      const patch = this.normalizeCandidatePatch(current, input)
      updated = { ...current, ...patch, updatedAt: Date.now() }
      candidates[index] = updated
    })
    return updated
  }

  async removeCandidate(id: string) {
    const safeId = this.assertUuid(id)
    await this.store.update((state) => {
      const candidates = this.candidatesOf(state)
      if (!candidates.some((candidate) => candidate.id === safeId)) throw new NotFoundException('Travel candidate was not found')
      state.candidates = candidates.filter((candidate) => candidate.id !== safeId)
    })
    return { id: safeId, removed: true }
  }

  async addCandidateToTrip(id: string, tripId: string, dayId: string) {
    const safeCandidateId = this.assertUuid(id)
    const safeTripId = this.assertUuid(tripId)
    const safeDayId = this.assertUuid(dayId)
    let result!: { candidate: TravelCandidate; trip: Trip; place: TripPlace }
    await this.store.update((state) => {
      const candidates = this.candidatesOf(state)
      const candidateIndex = candidates.findIndex((candidate) => candidate.id === safeCandidateId)
      if (candidateIndex < 0) throw new NotFoundException('Travel candidate was not found')
      const candidate = candidates[candidateIndex]
      if (candidate.status === 'added') throw new ConflictException('Travel candidate has already been added to a trip')
      const tripIndex = state.trips.findIndex((trip) => trip.id === safeTripId)
      if (tripIndex < 0) throw new NotFoundException('Trip was not found')
      const trip = structuredClone(state.trips[tripIndex])
      if (trip.status === 'archived') throw new BadRequestException('Archived trips cannot receive candidates')
      if (privacyWeight(trip.privacy) < privacyWeight(candidate.privacy)) {
        throw new BadRequestException('Trip privacy must be at least as restrictive as the candidate privacy')
      }
      const day = trip.days.find((item) => item.id === safeDayId)
      if (!day) throw new NotFoundException('Trip day was not found')
      const place: TripPlace = {
        id: randomUUID(),
        name: required(candidate.placeName, 300, 'Candidate place name'),
        address: clean(candidate.address, 500, 'Candidate address'),
        location: candidate.location ? normalizePoint(candidate.location) : undefined,
        notes: clean(candidate.notes, 10_000, 'Candidate notes')
      }
      day.places.push(place)
      trip.updatedAt = Date.now()
      const updatedTrip = this.normalizeTrip(trip)
      state.trips[tripIndex] = updatedTrip
      const updatedCandidate: TravelCandidate = {
        ...candidate,
        status: 'added',
        tripId: safeTripId,
        dayId: safeDayId,
        placeId: place.id,
        updatedAt: trip.updatedAt
      }
      candidates[candidateIndex] = updatedCandidate
      result = { candidate: updatedCandidate, trip: updatedTrip, place }
    })
    await this.syncResourceIndex()
    return result
  }

  async create(input: CreateTripInput) {
    const now = Date.now()
    const trip = this.normalizeTrip({
      id: randomUUID(),
      title: input.title,
      description: input.description || '',
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: input.timezone,
      currency: input.currency,
      status: 'planning',
      privacy: input.privacy || 'private',
      tags: input.tags || [],
      travelers: input.travelers || [],
      days: [], segments: [], bookings: [], budget: [], checklist: [], attachments: [],
      createdAt: now, updatedAt: now
    })
    await this.store.update((state) => {
      if (state.trips.length >= MAX_TRIPS) throw new BadRequestException('Trip limit reached')
      state.trips.push(trip)
    })
    await this.syncResourceIndex()
    return trip
  }

  async update(id: string, input: UpdateTripInput) {
    const safeId = this.assertUuid(id)
    if ('attachments' in input) throw new BadRequestException('Use the travel attachment endpoints to change attachments')
    let updated!: Trip
    await this.store.update((state) => {
      const index = state.trips.findIndex((trip) => trip.id === safeId)
      if (index < 0) throw new NotFoundException('Trip was not found')
      const current = this.hydrateTrip(state.trips[index])
      updated = this.normalizeTrip({ ...current, ...input, attachments: current.attachments, id: safeId, createdAt: current.createdAt, updatedAt: Date.now() })
      state.trips[index] = updated
    })
    await this.syncResourceIndex()
    return updated
  }

  async remove(id: string) {
    await this.attachmentInitialization
    const safeId = this.assertUuid(id)
    const snapshot = await this.store.read()
    const snapshotTrip = this.hydrateTrip(this.requireTrip(snapshot, safeId))
    if (snapshotTrip.attachments.length) await this.attachmentStore.ensureAvailable()
    let attachmentIds: string[] = []
    await this.store.update((state) => {
      const trip = state.trips.find((item) => item.id === safeId)
      if (!trip) throw new NotFoundException('Trip was not found')
      attachmentIds = this.hydrateTrip(trip).attachments.map((item) => item.id)
      state.trips = state.trips.filter((trip) => trip.id !== safeId)
    })
    if (attachmentIds.length) await this.attachmentStore.removeMany(attachmentIds).catch((cause) => {
      this.attachmentCleanupError = this.safeAttachmentError(cause)
    })
    await this.syncResourceIndex()
    return { id: safeId, removed: true }
  }

  async duplicate(id: string) {
    await this.attachmentInitialization
    const source = this.normalizeTrip(await this.findOne(id))
    const now = Date.now()
    const dayIdMap = new Map<string, string>()
    const placeIdMap = new Map<string, string>()
    const bookingIdMap = new Map<string, string>()
    const days = source.days.map((day) => {
      const dayId = randomUUID()
      dayIdMap.set(day.id, dayId)
      return {
        ...day,
        id: dayId,
        places: day.places.map((place) => {
          const nextId = randomUUID()
          placeIdMap.set(place.id, nextId)
          return { ...place, id: nextId }
        })
      }
    })
    const bookings = source.bookings.map((booking) => {
      const bookingId = randomUUID()
      bookingIdMap.set(booking.id, bookingId)
      return { ...booking, id: bookingId }
    })
    const copiedAttachmentIds: string[] = []
    let cloned!: Trip
    try {
      const attachments: TripAttachment[] = []
      for (const attachment of source.attachments) {
        const nextId = randomUUID()
        const row = await this.attachmentStore.get(attachment.id)
        if (row.createdAt !== attachment.createdAt || row.content.length !== attachment.size) throw new ServiceUnavailableException('Travel attachment metadata does not match its encrypted body')
        await this.attachmentStore.put(nextId, row.content, now)
        copiedAttachmentIds.push(nextId)
        attachments.push({
          ...attachment,
          id: nextId,
          scopeId: this.remapAttachmentScopeId(attachment, dayIdMap, placeIdMap, bookingIdMap),
          createdAt: now
        })
      }
      cloned = this.normalizeTrip({
        ...structuredClone(source),
        id: randomUUID(),
        title: `${source.title} Copy`,
        status: 'planning',
        days,
        segments: source.segments.map((segment) => ({
          ...segment,
          id: randomUUID(),
          fromPlaceId: segment.fromPlaceId ? placeIdMap.get(segment.fromPlaceId) : undefined,
          toPlaceId: segment.toPlaceId ? placeIdMap.get(segment.toPlaceId) : undefined
        })),
        bookings,
        budget: source.budget.map((item) => ({ ...item, id: randomUUID() })),
        checklist: source.checklist.map((item) => ({ ...item, id: randomUUID(), completed: false })),
        attachments,
        createdAt: now,
        updatedAt: now
      })
      await this.store.update((state) => {
        if (state.trips.length >= MAX_TRIPS) throw new BadRequestException('Trip limit reached')
        state.trips.push(cloned)
      })
    } catch (cause) {
      if (copiedAttachmentIds.length) await this.attachmentStore.removeMany(copiedAttachmentIds).catch(() => undefined)
      throw cause
    }
    await this.syncResourceIndex()
    return cloned
  }

  async getSummary(id: string) {
    const trip = await this.findOne(id)
    return {
      budgetByCurrency: this.summarizeBudget(trip.budget),
      totalDistanceKm: round(trip.segments.reduce((sum, segment) => sum + (segment.distanceKm || 0), 0), 2),
      totalDurationMinutes: trip.segments.reduce((sum, segment) => sum + (segment.durationMinutes || 0), 0),
      checklist: { completed: trip.checklist.filter((item) => item.completed).length, total: trip.checklist.length },
      days: trip.days.length,
      places: trip.days.reduce((sum, day) => sum + day.places.length, 0),
      bookings: trip.bookings.length,
      attachments: {
        count: trip.attachments.length,
        bytes: trip.attachments.reduce((sum, item) => sum + item.size, 0)
      }
    }
  }

  async exportTrip(id: string, format: 'json' | 'markdown') {
    const trip = await this.findOne(id)
    if (format === 'json') return { format, filename: `${trip.id}.json`, content: `${JSON.stringify(trip, null, 2)}\n` }
    if (format !== 'markdown') throw new BadRequestException('Unsupported export format')
    return { format, filename: `${slugify(trip.title) || trip.id}.md`, content: this.toMarkdown(trip) }
  }

  async addAttachment(tripId: string, input: CreateTripAttachmentInput) {
    await this.attachmentInitialization
    const safeTripId = this.assertUuid(tripId)
    if (!Buffer.isBuffer(input.content) || input.content.length < 1 || input.content.length > TRAVEL_ATTACHMENT_LIMITS.perFileBytes) {
      throw new BadRequestException(`Attachment must be between 1 byte and ${TRAVEL_ATTACHMENT_LIMITS.perFileBytes} bytes`)
    }
    const createdAt = Date.now()
    const attachment: TripAttachment = {
      id: randomUUID(),
      filename: normalizeAttachmentFilename(input.filename),
      mimeType: normalizeMimeType(input.mimeType),
      size: input.content.length,
      scope: normalizeAttachmentScope(input.scope),
      scopeId: input.scope === 'trip' ? undefined : this.assertUuid(input.scopeId || ''),
      createdAt
    }
    const snapshot = await this.store.read()
    const current = this.normalizeTrip(this.hydrateTrip(this.requireTrip(snapshot, safeTripId)))
    this.normalizeAttachments([...current.attachments, attachment], current.days, current.bookings)

    await this.attachmentStore.put(attachment.id, input.content, createdAt)
    let updated!: Trip
    try {
      await this.store.update((state) => {
        const index = state.trips.findIndex((trip) => trip.id === safeTripId)
        if (index < 0) throw new NotFoundException('Trip was not found')
        const trip = this.hydrateTrip(state.trips[index])
        updated = this.normalizeTrip({ ...trip, attachments: [...trip.attachments, attachment], updatedAt: Date.now() })
        state.trips[index] = updated
      })
    } catch (cause) {
      await this.attachmentStore.remove(attachment.id).catch(() => undefined)
      throw cause
    }
    await this.syncResourceIndex()
    return { attachment, trip: updated }
  }

  async getAttachment(tripId: string, attachmentId: string) {
    await this.attachmentInitialization
    const trip = await this.findOne(this.assertUuid(tripId))
    const safeAttachmentId = this.assertUuid(attachmentId)
    const attachment = trip.attachments.find((item) => item.id === safeAttachmentId)
    if (!attachment) throw new NotFoundException('Travel attachment was not found')
    const row = await this.attachmentStore.get(safeAttachmentId)
    if (row.createdAt !== attachment.createdAt || row.content.length !== attachment.size) {
      throw new ServiceUnavailableException('Travel attachment metadata does not match its encrypted body')
    }
    return { attachment, content: row.content }
  }

  async removeAttachment(tripId: string, attachmentId: string) {
    await this.attachmentInitialization
    const safeTripId = this.assertUuid(tripId)
    const safeAttachmentId = this.assertUuid(attachmentId)
    await this.attachmentStore.ensureAvailable()
    let removed!: TripAttachment
    let updated!: Trip
    await this.store.update((state) => {
      const index = state.trips.findIndex((trip) => trip.id === safeTripId)
      if (index < 0) throw new NotFoundException('Trip was not found')
      const trip = this.hydrateTrip(state.trips[index])
      const attachment = trip.attachments.find((item) => item.id === safeAttachmentId)
      if (!attachment) throw new NotFoundException('Travel attachment was not found')
      removed = attachment
      updated = this.normalizeTrip({ ...trip, attachments: trip.attachments.filter((item) => item.id !== safeAttachmentId), updatedAt: Date.now() })
      state.trips[index] = updated
    })
    await this.attachmentStore.remove(safeAttachmentId).catch((cause) => {
      this.attachmentCleanupError = this.safeAttachmentError(cause)
    })
    await this.syncResourceIndex()
    return { attachment: removed, trip: updated, removed: true }
  }

  async exportOfflinePackage(id: string, passphrase: string) {
    await this.attachmentInitialization
    const trip = this.normalizeTrip(await this.findOne(id))
    if (Buffer.byteLength(JSON.stringify(trip), 'utf8') > MAX_TRIP_JSON_PACKAGE_BYTES) throw new BadRequestException('Trip structure is too large for an offline package')
    const attachments: TravelOfflinePackagePayload['attachments'] = []
    for (const metadata of trip.attachments) {
      const row = await this.attachmentStore.get(metadata.id)
      if (row.createdAt !== metadata.createdAt || row.content.length !== metadata.size) throw new ServiceUnavailableException('Travel attachment metadata does not match its encrypted body')
      attachments.push({ metadata, content: row.content.toString('base64') })
    }
    try {
      const content = encryptTravelOfflinePackage({
        format: 'terra-trip-package-payload',
        version: 1,
        exportedAt: Date.now(),
        trip,
        attachments
      }, passphrase)
      return { filename: `${slugify(trip.title) || trip.id}.terra-trip`, content }
    } catch (cause) {
      throw new BadRequestException(this.safePackageError(cause))
    }
  }

  async importOfflinePackage(content: Buffer, passphrase: string) {
    await this.attachmentInitialization
    let payload: TravelOfflinePackagePayload
    try {
      payload = decryptTravelOfflinePackage(content, passphrase)
    } catch (cause) {
      throw new BadRequestException(this.safePackageError(cause))
    }
    if (!Number.isSafeInteger(payload.exportedAt) || payload.exportedAt < 0 || !Array.isArray(payload.attachments)) throw new BadRequestException('Offline trip package payload is invalid')
    if (Buffer.byteLength(JSON.stringify(payload.trip), 'utf8') > MAX_TRIP_JSON_PACKAGE_BYTES) throw new BadRequestException('Offline trip structure is too large')
    const source = this.normalizeTrip(this.hydrateTrip(payload.trip))
    if (payload.attachments.length !== source.attachments.length) throw new BadRequestException('Offline trip attachment manifest is incomplete')
    const packageEntries = new Map(payload.attachments.map((entry) => [entry?.metadata?.id, entry]))
    if (packageEntries.size !== payload.attachments.length) throw new BadRequestException('Offline trip attachment manifest contains duplicates')

    const importedBuffers = new Map<string, Buffer>()
    let attachmentBytes = 0
    for (const metadata of source.attachments) {
      const entry = packageEntries.get(metadata.id)
      if (!entry || !sameAttachmentMetadata(metadata, entry.metadata)) throw new BadRequestException('Offline trip attachment metadata is inconsistent')
      const decoded = decodeAttachmentBase64(entry.content, metadata.size)
      attachmentBytes += decoded.length
      if (attachmentBytes > TRAVEL_ATTACHMENT_LIMITS.perTripBytes) throw new BadRequestException('Offline trip attachments exceed the per-trip storage budget')
      importedBuffers.set(metadata.id, decoded)
    }

    const state = await this.store.read()
    if (state.trips.length >= MAX_TRIPS) throw new BadRequestException('Trip limit reached')
    const now = Date.now()
    const attachmentIdMap = new Map(source.attachments.map((item) => [item.id, randomUUID()]))
    const imported = this.normalizeTrip({
      ...structuredClone(source),
      id: randomUUID(),
      attachments: source.attachments.map((item) => ({ ...item, id: attachmentIdMap.get(item.id)! })),
      createdAt: now,
      updatedAt: now
    })
    const writtenIds: string[] = []
    try {
      for (const sourceAttachment of source.attachments) {
        const nextId = attachmentIdMap.get(sourceAttachment.id)!
        await this.attachmentStore.put(nextId, importedBuffers.get(sourceAttachment.id)!, sourceAttachment.createdAt)
        writtenIds.push(nextId)
      }
      await this.store.update((draft) => {
        if (draft.trips.length >= MAX_TRIPS) throw new BadRequestException('Trip limit reached')
        draft.trips.push(imported)
      })
    } catch (cause) {
      if (writtenIds.length) await this.attachmentStore.removeMany(writtenIds).catch(() => undefined)
      throw cause
    }
    await this.syncResourceIndex()
    return imported
  }

  private normalizeTrip(input: Trip): Trip {
    const title = clean(input.title, 300, 'Trip title')
    if (!title) throw new BadRequestException('Trip title is required')
    const startDate = this.normalizeDate(input.startDate, 'Start date')
    const endDate = this.normalizeDate(input.endDate, 'End date')
    const rangeDays = daysBetween(startDate, endDate)
    if (rangeDays < 0) throw new BadRequestException('End date cannot be before start date')
    if (rangeDays > 365) throw new BadRequestException('Trip cannot exceed 366 days')
    const timezone = this.normalizeTimezone(input.timezone)
    const currency = this.normalizeCurrency(input.currency)
    const days = this.normalizeDays(input.days || [], startDate, endDate, currency)
    const placeMap = new Map(days.flatMap((day) => day.places.map((place) => [place.id, place] as const)))
    const segments = this.normalizeSegments(input.segments || [], placeMap, currency)
    const bookings = this.normalizeBookings(input.bookings || [], currency)
    const budget = this.normalizeBudget(input.budget || [], currency)
    const checklist = this.normalizeChecklist(input.checklist || [])
    const attachments = this.normalizeAttachments(input.attachments || [], days, bookings)
    assertUniqueIds(days, 'trip days')
    assertUniqueIds(days.flatMap((day) => day.places), 'trip places')
    assertUniqueIds(segments, 'trip segments')
    assertUniqueIds(bookings, 'trip bookings')
    assertUniqueIds(budget, 'trip budget items')
    assertUniqueIds(checklist, 'trip checklist items')
    assertUniqueIds(attachments, 'trip attachments')
    const nestedCount = days.reduce((sum, day) => sum + day.places.length, 0) + segments.length + bookings.length + budget.length + checklist.length + attachments.length
    if (nestedCount > MAX_NESTED_ITEMS) throw new BadRequestException('Trip contains too many nested items')
    const createdAt = normalizeTimestamp(input.createdAt, 'createdAt')
    const updatedAt = normalizeTimestamp(input.updatedAt, 'updatedAt')
    if (updatedAt < createdAt) throw new BadRequestException('updatedAt cannot be before createdAt')

    return {
      id: this.assertUuid(input.id),
      title,
      description: clean(input.description || '', 10_000, 'Description'),
      startDate, endDate, timezone, currency,
      status: this.normalizeStatus(input.status),
      privacy: this.normalizePrivacy(input.privacy),
      tags: normalizeStrings(input.tags || [], 30, 64, 'Tag'),
      travelers: normalizeStrings(input.travelers || [], 100, 120, 'Traveler'),
      days, segments, bookings, budget, checklist, attachments,
      createdAt,
      updatedAt
    }
  }

  private normalizeDays(days: TripDay[], startDate: string, endDate: string, currency: string) {
    if (!Array.isArray(days) || days.length > MAX_DAYS) throw new BadRequestException('Invalid trip days')
    const seenDates = new Set<string>()
    return days.map((day) => {
      const date = this.normalizeDate(day.date, 'Day date')
      if (date < startDate || date > endDate) throw new BadRequestException(`Day ${date} is outside trip range`)
      if (seenDates.has(date)) throw new BadRequestException(`Duplicate trip day: ${date}`)
      seenDates.add(date)
      return {
        id: ensureUuid(day.id), date,
        title: clean(day.title || '', 300, 'Day title'),
        notes: clean(day.notes || '', 10_000, 'Day notes'),
        places: this.normalizePlaces(day.places || [], currency)
      }
    }).sort((a, b) => a.date.localeCompare(b.date))
  }

  private normalizePlaces(places: TripPlace[], defaultCurrency: string) {
    if (!Array.isArray(places) || places.length > 1_000) throw new BadRequestException('Invalid places')
    return places.map((place) => {
      const startTime = optionalTime(place.startTime)
      const endTime = optionalTime(place.endTime)
      if (startTime && endTime && endTime < startTime) throw new BadRequestException('Place end time cannot be before start time')
      return {
        id: ensureUuid(place.id),
        name: required(place.name, 300, 'Place name'),
        address: clean(place.address || '', 1_000, 'Address'),
        location: place.location ? normalizePoint(place.location) : undefined,
        startTime, endTime,
        notes: clean(place.notes || '', 10_000, 'Place notes'),
        cost: optionalAmount(place.cost),
        currency: place.cost === undefined ? undefined : this.normalizeCurrency(place.currency || defaultCurrency)
      }
    })
  }

  private normalizeSegments(segments: TripSegment[], places: Map<string, TripPlace>, defaultCurrency: string) {
    if (!Array.isArray(segments) || segments.length > 2_000) throw new BadRequestException('Invalid segments')
    return segments.map((segment) => {
      const departureAt = optionalInstant(segment.departureAt)
      const arrivalAt = optionalInstant(segment.arrivalAt)
      if (departureAt && arrivalAt && Date.parse(arrivalAt) < Date.parse(departureAt)) throw new BadRequestException('Segment arrival cannot be before departure')
      const from = segment.fromPlaceId ? places.get(segment.fromPlaceId) : undefined
      const to = segment.toPlaceId ? places.get(segment.toPlaceId) : undefined
      if (segment.fromPlaceId && !from) throw new BadRequestException('Segment fromPlaceId does not exist')
      if (segment.toPlaceId && !to) throw new BadRequestException('Segment toPlaceId does not exist')
      if (segment.fromPlaceId && segment.fromPlaceId === segment.toPlaceId) throw new BadRequestException('Segment endpoints must be different')
      const fromName = clean(segment.fromName || from?.name || '', 300, 'From name')
      const toName = clean(segment.toName || to?.name || '', 300, 'To name')
      if (!fromName || !toName) throw new BadRequestException('Segment requires both endpoints')
      const computedDistance = from?.location && to?.location ? haversineKm(from.location, to.location) : undefined
      const computedDuration = departureAt && arrivalAt ? Math.round((Date.parse(arrivalAt) - Date.parse(departureAt)) / 60_000) : undefined
      return {
        id: ensureUuid(segment.id),
        fromPlaceId: segment.fromPlaceId,
        toPlaceId: segment.toPlaceId,
        fromName,
        toName,
        mode: this.normalizeMode(segment.mode),
        departureAt, arrivalAt,
        provider: optionalText(segment.provider, 300, 'Provider'),
        reference: optionalText(segment.reference, 300, 'Reference'),
        distanceKm: computedDistance ?? optionalNonNegative(segment.distanceKm, 'Distance'),
        durationMinutes: computedDuration ?? optionalInteger(segment.durationMinutes, 'Duration'),
        cost: optionalAmount(segment.cost),
        currency: segment.cost === undefined ? undefined : this.normalizeCurrency(segment.currency || defaultCurrency),
        notes: clean(segment.notes || '', 10_000, 'Segment notes')
      }
    })
  }

  private normalizeBookings(items: TripBooking[], defaultCurrency: string) {
    if (!Array.isArray(items) || items.length > 2_000) throw new BadRequestException('Invalid bookings')
    return items.map((item) => {
      const startsAt = optionalInstant(item.startsAt), endsAt = optionalInstant(item.endsAt)
      if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new BadRequestException('Booking end cannot be before start')
      if (!['lodging', 'transport', 'activity', 'restaurant', 'other'].includes(item.type)) throw new BadRequestException('Invalid booking type')
      if (!['planned', 'confirmed', 'cancelled'].includes(item.status)) throw new BadRequestException('Invalid booking status')
      return { id: ensureUuid(item.id), type: item.type, title: required(item.title, 300, 'Booking title'), provider: optionalText(item.provider, 300, 'Provider'), confirmation: optionalText(item.confirmation, 500, 'Confirmation'), startsAt, endsAt, cost: optionalAmount(item.cost), currency: item.cost === undefined ? undefined : this.normalizeCurrency(item.currency || defaultCurrency), status: item.status, notes: clean(item.notes || '', 10_000, 'Booking notes') }
    })
  }

  private normalizeBudget(items: TripBudgetItem[], defaultCurrency: string) {
    if (!Array.isArray(items) || items.length > 5_000) throw new BadRequestException('Invalid budget')
    return items.map((item) => ({ id: ensureUuid(item.id), category: required(item.category, 120, 'Budget category'), amount: requiredAmount(item.amount), currency: this.normalizeCurrency(item.currency || defaultCurrency), paid: Boolean(item.paid), notes: clean(item.notes || '', 1_000, 'Budget notes') }))
  }

  private normalizeChecklist(items: TripChecklistItem[]) {
    if (!Array.isArray(items) || items.length > 5_000) throw new BadRequestException('Invalid checklist')
    return items.map((item) => ({ id: ensureUuid(item.id), text: required(item.text, 500, 'Checklist text'), completed: Boolean(item.completed), category: clean(item.category || '', 120, 'Checklist category') }))
  }

  private summarizeBudget(items: TripBudgetItem[]) {
    const result: Record<string, { total: number; paid: number; unpaid: number }> = {}
    for (const item of items) {
      result[item.currency] ||= { total: 0, paid: 0, unpaid: 0 }
      result[item.currency].total += item.amount
      result[item.currency][item.paid ? 'paid' : 'unpaid'] += item.amount
    }
    for (const value of Object.values(result)) { value.total = round(value.total, 2); value.paid = round(value.paid, 2); value.unpaid = round(value.unpaid, 2) }
    return result
  }

  private toMarkdown(trip: Trip) {
    const lines = [`# ${trip.title}`, '', `${trip.startDate} -> ${trip.endDate} | ${trip.timezone}`, '', trip.description, '']
    for (const day of trip.days) {
      lines.push(`## ${day.date}${day.title ? ` | ${day.title}` : ''}`, '')
      for (const place of day.places) lines.push(`- ${[place.startTime, place.name, place.address].filter(Boolean).join(' | ')}${place.notes ? ` - ${place.notes}` : ''}`)
      if (day.notes) lines.push('', day.notes)
      lines.push('')
    }
    if (trip.bookings.length) { lines.push('## Bookings', ''); for (const item of trip.bookings) lines.push(`- ${item.title} | ${item.status}${item.confirmation ? ` | ${item.confirmation}` : ''}`); lines.push('') }
    if (trip.checklist.length) { lines.push('## Checklist', ''); for (const item of trip.checklist) lines.push(`- [${item.completed ? 'x' : ' '}] ${item.text}`); lines.push('') }
    if (trip.attachments.length) { lines.push('## Attachments', ''); for (const item of trip.attachments) lines.push(`- ${item.filename} | ${item.mimeType} | ${item.size} bytes`); lines.push('') }
    return `${lines.join('\n').trimEnd()}\n`
  }

  private async syncResourceIndex() {
    try {
      const state = await this.store.read()
      const resources: Resource[] = state.trips.map((source) => {
        const trip = this.hydrateTrip(source)
        return { id: `travel:trip:${trip.id}`, type: 'trip', source: 'travel', sourceId: trip.id, title: trip.title, summary: compact(`${trip.startDate} ${trip.endDate} ${trip.description}`).slice(0, 500), content: this.toMarkdown(trip), tags: trip.tags, privacy: trip.privacy, context: { projects: [trip.title], time: { startDate: trip.startDate, endDate: trip.endDate, timezone: trip.timezone }, locations: tripResourceLocations(trip) }, archived: trip.status === 'archived', deleted: false, createdAt: trip.createdAt, updatedAt: trip.updatedAt, indexedAt: Date.now(), metadata: { startDate: trip.startDate, endDate: trip.endDate, timezone: trip.timezone, currency: trip.currency, status: trip.status, dayCount: trip.days.length, bookingCount: trip.bookings.length, attachmentCount: trip.attachments.length, budgetSummary: this.summarizeBudget(trip.budget) } }
      })
      await this.resourcesService.replaceSourceResources('travel', 'trip', resources)
      this.resourceSyncError = ''
    } catch (error) { this.resourceSyncError = error instanceof Error ? error.message.slice(0, 240) : 'Travel Resource sync failed'; console.warn('Travel Resource index sync failed', this.resourceSyncError) }
  }

  private normalizeAttachments(items: TripAttachment[], days: TripDay[], bookings: TripBooking[]) {
    if (!Array.isArray(items) || items.length > TRAVEL_ATTACHMENT_LIMITS.perTripCount) throw new BadRequestException('Invalid trip attachments')
    const dayIds = new Set(days.map((day) => day.id))
    const placeIds = new Set(days.flatMap((day) => day.places.map((place) => place.id)))
    const bookingIds = new Set(bookings.map((booking) => booking.id))
    let totalBytes = 0
    return items.map((item) => {
      const scope = normalizeAttachmentScope(item.scope)
      const scopeId = scope === 'trip' ? undefined : strictUuid(item.scopeId)
      if (scope === 'day' && !dayIds.has(scopeId!)) throw new BadRequestException('Attachment day scope does not exist')
      if (scope === 'place' && !placeIds.has(scopeId!)) throw new BadRequestException('Attachment place scope does not exist')
      if (scope === 'booking' && !bookingIds.has(scopeId!)) throw new BadRequestException('Attachment booking scope does not exist')
      const size = Number(item.size)
      if (!Number.isSafeInteger(size) || size < 1 || size > TRAVEL_ATTACHMENT_LIMITS.perFileBytes) throw new BadRequestException('Invalid attachment size')
      totalBytes += size
      if (totalBytes > TRAVEL_ATTACHMENT_LIMITS.perTripBytes) throw new BadRequestException('Trip attachments exceed the per-trip storage budget')
      return {
        id: strictUuid(item.id),
        filename: normalizeAttachmentFilename(item.filename),
        mimeType: normalizeMimeType(item.mimeType),
        size,
        scope,
        scopeId,
        createdAt: normalizeTimestamp(item.createdAt, 'attachment createdAt')
      }
    })
  }

  private candidatesOf(state: TravelState) {
    state.candidates ||= []
    return state.candidates
  }

  private normalizeCandidatePatch(current: TravelCandidate, input: UpdateTravelCandidateInput): Partial<TravelCandidate> {
    const patch: Partial<TravelCandidate> = {}
    if ('title' in input) patch.title = required(input.title, 300, 'Candidate title')
    if ('summary' in input) patch.summary = clean(input.summary || '', 2_000, 'Candidate summary')
    if ('tags' in input) patch.tags = normalizeStrings(input.tags || [], 20, 64, 'Tag')
    if ('status' in input) {
      const status = this.normalizeCandidateStatus(input.status || '')
      if (status === 'added' && current.status !== 'added') throw new BadRequestException('Use add-to-trip to mark a candidate as added')
      patch.status = status
    }
    if ('placeName' in input) patch.placeName = required(input.placeName, 300, 'Candidate place name')
    if ('address' in input) patch.address = clean(input.address || '', 500, 'Candidate address')
    if ('location' in input) patch.location = input.location ? normalizePoint(input.location) : undefined
    if ('notes' in input) patch.notes = clean(input.notes || '', 10_000, 'Candidate notes')
    return patch
  }

  private normalizeCandidateStatus(value: string) {
    if (!CANDIDATE_STATUSES.has(value as TravelCandidateStatus)) throw new BadRequestException('Invalid travel candidate status')
    return value as TravelCandidateStatus
  }

  private normalizeCandidateSource(value: string) {
    if (value !== 'xiaomi' && value !== 'rss') throw new BadRequestException('Invalid travel candidate source')
    return value
  }

  private sourceUrlFromResource(value: unknown) {
    if (typeof value !== 'string' || !value) return undefined
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
    } catch {
      return undefined
    }
  }

  private async initializeAttachmentReferences() {
    try {
      const state = await this.store.read()
      const referenced = new Set(state.trips.flatMap((trip) => this.hydrateTrip(trip).attachments.map((attachment) => attachment.id)))
      const stored = new Set(await this.attachmentStore.listIds())
      const missing = [...referenced].filter((id) => !stored.has(id))
      await this.attachmentStore.removeUnreferenced(referenced)
      this.attachmentCleanupError = missing.length ? `${missing.length} travel attachment bodies are missing; restore the matching attachment database` : ''
    } catch (cause) {
      this.attachmentCleanupError = this.safeAttachmentError(cause)
    }
  }

  private hydrateTrip(trip: Trip): Trip {
    return { ...structuredClone(trip), attachments: Array.isArray(trip.attachments) ? structuredClone(trip.attachments) : [] }
  }

  private remapAttachmentScopeId(
    attachment: TripAttachment,
    dayIdMap: Map<string, string>,
    placeIdMap: Map<string, string>,
    bookingIdMap: Map<string, string>
  ) {
    if (attachment.scope === 'trip') return undefined
    const mapped = attachment.scope === 'day'
      ? dayIdMap.get(attachment.scopeId || '')
      : attachment.scope === 'place'
        ? placeIdMap.get(attachment.scopeId || '')
        : bookingIdMap.get(attachment.scopeId || '')
    if (!mapped) throw new ServiceUnavailableException('Travel attachment scope reference could not be copied')
    return mapped
  }

  private safeAttachmentError(cause: unknown) {
    return (cause instanceof Error ? cause.message : 'Travel attachment cleanup failed').replace(/[\r\n]/g, ' ').slice(0, 240)
  }

  private safePackageError(cause: unknown) {
    return (cause instanceof Error ? cause.message : 'Offline trip package could not be processed').replace(/[\r\n]/g, ' ').slice(0, 240)
  }

  private isState(value: unknown): value is TravelState {
    const state = value as Partial<TravelState>
    return Boolean(
      state &&
      Array.isArray(state.trips) && state.trips.length <= MAX_TRIPS && state.trips.every((trip) => this.isTripShape(trip)) &&
      (state.candidates === undefined || Array.isArray(state.candidates) && state.candidates.length <= MAX_CANDIDATES && state.candidates.every((candidate) => this.isCandidateShape(candidate)))
    )
  }
  private isCandidateShape(value: unknown): value is TravelCandidate {
    const candidate = value as Partial<TravelCandidate>
    return Boolean(
      candidate && typeof candidate.id === 'string' &&
      typeof candidate.sourceResourceId === 'string' && candidate.sourceResourceId.length <= 300 &&
      (candidate.source === 'xiaomi' || candidate.source === 'rss') &&
      typeof candidate.sourceId === 'string' && candidate.sourceId.length <= 200 &&
      typeof candidate.title === 'string' && candidate.title.length <= 300 &&
      typeof candidate.summary === 'string' && candidate.summary.length <= 2_000 &&
      (candidate.sourceUrl === undefined || typeof candidate.sourceUrl === 'string' && candidate.sourceUrl.length <= 4_096) &&
      Array.isArray(candidate.tags) && candidate.tags.length <= 20 && candidate.tags.every((tag) => typeof tag === 'string' && tag.length <= 64) &&
      typeof candidate.privacy === 'string' && PRIVACY.has(candidate.privacy as TravelPrivacy) &&
      typeof candidate.status === 'string' && CANDIDATE_STATUSES.has(candidate.status as TravelCandidateStatus) &&
      typeof candidate.placeName === 'string' && candidate.placeName.length <= 300 &&
      typeof candidate.address === 'string' && candidate.address.length <= 500 &&
      (candidate.location === undefined || isGeoPoint(candidate.location)) &&
      typeof candidate.notes === 'string' && candidate.notes.length <= 10_000 &&
      (candidate.tripId === undefined || typeof candidate.tripId === 'string') &&
      (candidate.dayId === undefined || typeof candidate.dayId === 'string') &&
      (candidate.placeId === undefined || typeof candidate.placeId === 'string') &&
      Number.isSafeInteger(candidate.sourceUpdatedAt) && candidate.sourceUpdatedAt! >= 0 &&
      Number.isSafeInteger(candidate.createdAt) && candidate.createdAt! >= 0 &&
      Number.isSafeInteger(candidate.updatedAt) && candidate.updatedAt! >= candidate.createdAt!
    )
  }
  private isTripShape(value: unknown): value is Trip { const trip = value as Partial<Trip>; return Boolean(trip && typeof trip.id === 'string' && typeof trip.title === 'string' && typeof trip.startDate === 'string' && typeof trip.endDate === 'string' && typeof trip.timezone === 'string' && typeof trip.currency === 'string' && Array.isArray(trip.days) && Array.isArray(trip.segments) && Array.isArray(trip.bookings) && Array.isArray(trip.budget) && Array.isArray(trip.checklist) && (trip.attachments === undefined || Array.isArray(trip.attachments) && trip.attachments.length <= TRAVEL_ATTACHMENT_LIMITS.perTripCount && trip.attachments.every((attachment) => isAttachmentShape(attachment))) && typeof trip.createdAt === 'number' && typeof trip.updatedAt === 'number') }
  private requireTrip(state: TravelState, id: string) { const safe = this.assertUuid(id); const trip = state.trips.find((item) => item.id === safe); if (!trip) throw new NotFoundException('Trip was not found'); return trip }
  private normalizeDate(value: string, label: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label} must use YYYY-MM-DD`); const date = new Date(`${value}T00:00:00Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label} is not a real calendar date`); return value }
  private normalizeTimezone(value: string) { try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return value } catch { throw new BadRequestException('Invalid IANA timezone') } }
  private normalizeCurrency(value: string) { const currency = String(value || '').trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Currency must be a 3-letter code'); return currency }
  private normalizeStatus(value: string) { if (!STATUSES.has(value as TripStatus)) throw new BadRequestException('Invalid trip status'); return value as TripStatus }
  private normalizePrivacy(value: string) { if (!PRIVACY.has(value as TravelPrivacy)) throw new BadRequestException('Invalid privacy level'); return value as TravelPrivacy }
  private normalizeMode(value: string) { if (!MODES.has(value as TravelMode)) throw new BadRequestException('Invalid travel mode'); return value as TravelMode }
  private assertUuid(value: string) { return ensureUuid(value) }
}

function ensureUuid(value?: string) { if (value === undefined || value === '') return randomUUID(); return strictUuid(value) }
function strictUuid(value: unknown) { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('Invalid UUID'); return value }
function clean(value: unknown, max: number, label: string) { if (typeof value !== 'string') throw new BadRequestException(`${label} must be text`); const text = value.trim(); if (text.length > max) throw new BadRequestException(`${label} exceeds ${max} characters`); return text }
function required(value: unknown, max: number, label: string) { const text = clean(value, max, label); if (!text) throw new BadRequestException(`${label} is required`); return text }
function optionalText(value: unknown, max: number, label: string) { if (value === undefined || value === '') return undefined; return clean(value, max, label) }
function optionalTime(value?: string) { if (!value) return undefined; if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new BadRequestException('Time must use HH:MM'); return value }
function optionalInstant(value?: string) { if (!value) return undefined; if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequestException('Date-time must be ISO 8601 with timezone offset'); return new Date(value).toISOString() }
function normalizePoint(value: GeoPoint) { const latitude = Number(value.latitude), longitude = Number(value.longitude); if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new BadRequestException('Invalid coordinates'); return { latitude, longitude } }
function isGeoPoint(value: unknown): value is GeoPoint { const point = value as Partial<GeoPoint>; return Boolean(point && typeof point.latitude === 'number' && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 && typeof point.longitude === 'number' && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180) }
function optionalAmount(value?: number) { if (value === undefined) return undefined; return requiredAmount(value) }
function requiredAmount(value: number) { const amount = Number(value); if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) throw new BadRequestException('Invalid amount'); return round(amount, 2) }
function optionalNonNegative(value: number | undefined, label: string) { if (value === undefined) return undefined; const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new BadRequestException(`Invalid ${label}`); return round(number, 2) }
function optionalInteger(value: number | undefined, label: string) { if (value === undefined) return undefined; const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new BadRequestException(`Invalid ${label}`); return number }
function normalizeTimestamp(value: number, label: string) { const timestamp = Number(value); if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new BadRequestException(`Invalid ${label}`); return timestamp }
function normalizeAttachmentScope(value: unknown): TravelAttachmentScope { if (value !== 'trip' && value !== 'day' && value !== 'place' && value !== 'booking') throw new BadRequestException('Invalid attachment scope'); return value }
function normalizeAttachmentFilename(value: unknown) {
  if (typeof value !== 'string') throw new BadRequestException('Attachment filename must be text')
  const filename = value.replace(/\\/g, '/').split('/').pop()?.replace(/[\0-\x1f\x7f]/g, '').trim() || ''
  if (!filename || filename.length > 255) throw new BadRequestException('Attachment filename is invalid')
  return filename
}
function normalizeMimeType(value: unknown) {
  if (typeof value !== 'string') throw new BadRequestException('Attachment MIME type must be text')
  const mimeType = value.split(';', 1)[0].trim().toLowerCase()
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType) || mimeType.length > 120) throw new BadRequestException('Attachment MIME type is invalid')
  return mimeType
}
function isAttachmentShape(value: unknown): value is TripAttachment {
  const item = value as Partial<TripAttachment>
  return Boolean(
    item && typeof item.id === 'string' && typeof item.filename === 'string' && typeof item.mimeType === 'string' &&
    Number.isSafeInteger(item.size) && item.size! > 0 && item.size! <= TRAVEL_ATTACHMENT_LIMITS.perFileBytes &&
    (item.scope === 'trip' || item.scope === 'day' || item.scope === 'place' || item.scope === 'booking') &&
    (item.scope === 'trip' ? item.scopeId === undefined : typeof item.scopeId === 'string') &&
    Number.isSafeInteger(item.createdAt) && item.createdAt! >= 0
  )
}
function sameAttachmentMetadata(left: TripAttachment, right: unknown) {
  const item = right as Partial<TripAttachment>
  return Boolean(item && left.id === item.id && left.filename === item.filename && left.mimeType === item.mimeType && left.size === item.size && left.scope === item.scope && left.scopeId === item.scopeId && left.createdAt === item.createdAt)
}
function decodeAttachmentBase64(value: unknown, expectedSize: number) {
  if (typeof value !== 'string' || value.length > Math.ceil(expectedSize / 3) * 4 + 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new BadRequestException('Offline trip attachment body is invalid')
  const content = Buffer.from(value, 'base64')
  if (content.length !== expectedSize || content.toString('base64') !== value) throw new BadRequestException('Offline trip attachment body is invalid')
  return content
}
function tripResourceLocations(trip: Trip) {
  const locations = trip.days.flatMap((day) => day.places.map((place) => ({
    name: place.name,
    address: place.address || undefined,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude
  })))
  return Array.from(new Map(locations.map((location) => [
    `${location.name}\u0000${location.address || ''}\u0000${location.latitude ?? ''}\u0000${location.longitude ?? ''}`,
    location
  ])).values()).slice(0, 100)
}
function assertUniqueIds(items: Array<{ id: string }>, label: string) { const ids = new Set(items.map((item) => item.id)); if (ids.size !== items.length) throw new BadRequestException(`Duplicate IDs in ${label}`) }
function normalizeStrings(values: string[], maxItems: number, maxLength: number, label: string) { if (!Array.isArray(values)) throw new BadRequestException(`${label}s must be an array`); const result = Array.from(new Set(values.map((value) => clean(value, maxLength, label)).filter(Boolean))); if (result.length > maxItems) throw new BadRequestException(`Too many ${label}s`); return result }
function daysBetween(start: string, end: string) { return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) }
function haversineKm(a: GeoPoint, b: GeoPoint) { const radians = (value: number) => value * Math.PI / 180; const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude); const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2; return round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)), 2) }
function round(value: number, digits: number) { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor }
function compact(value: string) { return value.replace(/\s+/g, ' ').trim() }
function slugify(value: string) { return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) }
function privacyWeight(value: TravelPrivacy) { return value === 'secret' ? 2 : value === 'private' ? 1 : 0 }
