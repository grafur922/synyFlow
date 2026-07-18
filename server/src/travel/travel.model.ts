export type TripStatus = 'planning' | 'active' | 'completed' | 'archived'
export type TravelPrivacy = 'public' | 'private' | 'secret'
export type TravelMode = 'walk' | 'bike' | 'drive' | 'transit' | 'train' | 'flight' | 'ferry' | 'other'
export type TravelCandidateStatus = 'inbox' | 'saved' | 'added' | 'dismissed'
export type TravelAttachmentScope = 'trip' | 'day' | 'place' | 'booking'
export type TravelMapProvider = 'amap' | 'apple' | 'google' | 'osm'

export interface GeoPoint { latitude: number; longitude: number }
export interface TripPlace {
  id: string
  name: string
  address: string
  location?: GeoPoint
  startTime?: string
  endTime?: string
  notes: string
  cost?: number
  currency?: string
}
export interface TripDay { id: string; date: string; title: string; notes: string; places: TripPlace[] }
export interface TripSegment {
  id: string
  fromPlaceId?: string
  toPlaceId?: string
  fromName: string
  toName: string
  mode: TravelMode
  departureAt?: string
  arrivalAt?: string
  provider?: string
  reference?: string
  distanceKm?: number
  durationMinutes?: number
  cost?: number
  currency?: string
  notes: string
}
export interface TripBooking {
  id: string
  type: 'lodging' | 'transport' | 'activity' | 'restaurant' | 'other'
  title: string
  provider?: string
  confirmation?: string
  startsAt?: string
  endsAt?: string
  cost?: number
  currency?: string
  status: 'planned' | 'confirmed' | 'cancelled'
  notes: string
}
export interface TripBudgetItem { id: string; category: string; amount: number; currency: string; paid: boolean; notes: string }
export interface TripChecklistItem { id: string; text: string; completed: boolean; category: string }
export interface TripAttachment {
  id: string
  filename: string
  mimeType: string
  size: number
  scope: TravelAttachmentScope
  scopeId?: string
  createdAt: number
}

export interface TravelMapTarget {
  name: string
  address?: string
  location?: GeoPoint
}

export interface TravelMapLinkInput {
  provider: TravelMapProvider
  kind: 'place' | 'route'
  target?: TravelMapTarget
  origin?: TravelMapTarget
  destination?: TravelMapTarget
  mode?: TravelMode
}

export interface TravelCandidate {
  id: string
  sourceResourceId: string
  source: 'xiaomi' | 'rss'
  sourceId: string
  title: string
  summary: string
  sourceUrl?: string
  tags: string[]
  privacy: TravelPrivacy
  status: TravelCandidateStatus
  placeName: string
  address: string
  location?: GeoPoint
  notes: string
  tripId?: string
  dayId?: string
  placeId?: string
  sourceUpdatedAt: number
  createdAt: number
  updatedAt: number
}

export interface Trip {
  id: string
  title: string
  description: string
  startDate: string
  endDate: string
  timezone: string
  currency: string
  status: TripStatus
  privacy: TravelPrivacy
  tags: string[]
  travelers: string[]
  days: TripDay[]
  segments: TripSegment[]
  bookings: TripBooking[]
  budget: TripBudgetItem[]
  checklist: TripChecklistItem[]
  attachments: TripAttachment[]
  createdAt: number
  updatedAt: number
}

export interface TravelState { trips: Trip[]; candidates?: TravelCandidate[] }
export type CreateTripInput = Pick<Trip, 'title' | 'description' | 'startDate' | 'endDate' | 'timezone' | 'currency' | 'privacy' | 'tags' | 'travelers'>
export type UpdateTripInput = Partial<Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>>
export interface UpdateTravelCandidateInput {
  title?: string
  summary?: string
  tags?: string[]
  status?: TravelCandidateStatus
  placeName?: string
  address?: string
  location?: GeoPoint | null
  notes?: string
}

export interface CreateTripAttachmentInput {
  filename: string
  mimeType: string
  scope: TravelAttachmentScope
  scopeId?: string
  content: Buffer
}
