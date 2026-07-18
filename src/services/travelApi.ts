import type {
  Trip,
  TravelCandidate,
  TravelCandidateStatus,
  TripExport,
  TripMetrics,
  TripSummary,
  TravelPrivacy,
  TravelStatus,
  TravelAttachmentScope,
  TravelMapLink,
  TravelMapLinkInput,
  TravelMapProviderInfo
} from '../shared/travel'

const configuredBase = (import.meta.env.VITE_TERRA_API_URL as string | undefined)?.replace(/\/$/, '')
const apiPrefix = configuredBase ? `${configuredBase}/api` : '/api'

async function request<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  try {
    const response = await fetch(`${apiPrefix}${path}`, { ...init, headers, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(parseError(text, response.statusText))
    return text ? JSON.parse(text) as T : undefined as T
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw new Error('请求超时')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

async function requestBlob(path: string, init?: RequestInit, timeoutMs = 120_000) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  try {
    const response = await fetch(`${apiPrefix}${path}`, { ...init, headers, signal: controller.signal })
    if (!response.ok) throw new Error(parseError(await response.text(), response.statusText))
    return response.blob()
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw new Error('请求超时')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

function parseError(text: string, fallback: string) {
  try {
    const payload = JSON.parse(text) as { message?: string | string[] | { message?: string } }
    if (Array.isArray(payload.message)) return payload.message.join('；')
    if (typeof payload.message === 'string') return payload.message
    if (payload.message?.message) return payload.message.message
  } catch {
    if (text) return text.slice(0, 200)
  }
  return fallback || '请求失败'
}

export const travelApi = {
  getStatus: () => request<TravelStatus>('/travel/status'),
  getMapProviders: () => request<TravelMapProviderInfo[]>('/travel/map/providers'),
  createMapLink(input: TravelMapLinkInput) {
    return request<TravelMapLink>('/travel/map/link', { method: 'POST', body: JSON.stringify(input) })
  },
  getCandidates(options: { status?: TravelCandidateStatus | ''; source?: 'xiaomi' | 'rss' | '' } = {}) {
    const query = new URLSearchParams()
    if (options.status) query.set('status', options.status)
    if (options.source) query.set('source', options.source)
    return request<TravelCandidate[]>(`/travel/candidates${query.size ? `?${query.toString()}` : ''}`)
  },
  importFavoriteCandidates(maxPrivacy: TravelPrivacy = 'private') {
    return request<{ eligible: number; imported: number; refreshed: number; unchanged: number }>(`/travel/candidates/import-favorites?maxPrivacy=${maxPrivacy}`, { method: 'POST' }, 120_000)
  },
  updateCandidate(id: string, input: Partial<Pick<TravelCandidate, 'title' | 'summary' | 'tags' | 'status' | 'placeName' | 'address' | 'notes'>> & { location?: TravelCandidate['location'] | null }) {
    return request<TravelCandidate>(`/travel/candidates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  deleteCandidate(id: string) {
    return request<{ id: string; removed: boolean }>(`/travel/candidates/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  addCandidateToTrip(id: string, tripId: string, dayId: string) {
    return request<{ candidate: TravelCandidate; trip: Trip; place: Trip['days'][number]['places'][number] }>(`/travel/candidates/${encodeURIComponent(id)}/add-to-trip`, { method: 'POST', body: JSON.stringify({ tripId, dayId }) })
  },
  getTrips: () => request<TripSummary[]>('/travel/trips'),
  getTrip: (id: string) => request<Trip>(`/travel/trips/${encodeURIComponent(id)}`),
  createTrip(input: { title: string; description: string; startDate: string; endDate: string; timezone: string; currency: string; privacy: TravelPrivacy; tags: string[]; travelers: string[] }) {
    return request<Trip>('/travel/trips', { method: 'POST', body: JSON.stringify(input) })
  },
  updateTrip(id: string, input: Partial<Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>>) {
    return request<Trip>(`/travel/trips/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  deleteTrip(id: string) {
    return request<{ id: string; removed: boolean }>(`/travel/trips/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  duplicateTrip(id: string) {
    return request<Trip>(`/travel/trips/${encodeURIComponent(id)}/duplicate`, { method: 'POST' })
  },
  getSummary: (id: string) => request<TripMetrics>(`/travel/trips/${encodeURIComponent(id)}/summary`),
  exportTrip(id: string, format: 'json' | 'markdown') {
    return request<TripExport>(`/travel/trips/${encodeURIComponent(id)}/export?format=${format}`)
  },
  uploadAttachment(id: string, file: File, scope: TravelAttachmentScope, scopeId?: string) {
    const headers = new Headers({
      'Content-Type': 'application/octet-stream',
      'X-Terra-Attachment-Name': encodeURIComponent(file.name),
      'X-Terra-Attachment-Mime': encodeURIComponent(file.type || 'application/octet-stream'),
      'X-Terra-Attachment-Scope': scope
    })
    if (scopeId) headers.set('X-Terra-Attachment-Scope-Id', scopeId)
    return request<{ attachment: Trip['attachments'][number]; trip: Trip }>(`/travel/trips/${encodeURIComponent(id)}/attachments`, { method: 'POST', headers, body: file }, 120_000)
  },
  downloadAttachment(tripId: string, attachmentId: string) {
    return requestBlob(`/travel/trips/${encodeURIComponent(tripId)}/attachments/${encodeURIComponent(attachmentId)}`)
  },
  removeAttachment(tripId: string, attachmentId: string) {
    return request<{ attachment: Trip['attachments'][number]; trip: Trip; removed: true }>(`/travel/trips/${encodeURIComponent(tripId)}/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' })
  },
  exportOfflinePackage(tripId: string, passphrase: string) {
    return requestBlob(`/travel/trips/${encodeURIComponent(tripId)}/offline-package`, { method: 'POST', body: JSON.stringify({ passphrase }) }, 180_000)
  },
  importOfflinePackage(file: File, passphrase: string) {
    return request<Trip>('/travel/offline-packages/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.terra.trip+json',
        'X-Terra-Package-Passphrase': encodeURIComponent(passphrase)
      },
      body: file
    }, 180_000)
  }
}
