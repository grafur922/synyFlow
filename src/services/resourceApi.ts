import type { Resource, ResourceSearchResult, ResourceStoreStatus, ResourceType, ResourcePrivacy } from '../shared/resource'

import type { ResourceSource, ResourceSummary } from '../shared/resource'
import type { ResourceConflictResolution, ResourceConflictSummary, ResourceConflictVersion, ResourceSyncMode } from '../shared/resource'

const configuredBase = (import.meta.env.VITE_TERRA_API_URL as string | undefined)?.replace(/\/$/, '')
const apiPrefix = configuredBase ? `${configuredBase}/api` : '/api'

async function request<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${apiPrefix}${path}`, { ...init, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) {
      let message = response.statusText
      try { message = (JSON.parse(text) as { message?: string }).message || message } catch { if (text) message = text.slice(0, 200) }
      throw new Error(message || '请求失败')
    }
    return text ? JSON.parse(text) as T : undefined as T
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw new Error('请求超时')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export const resourceApi = {
  getStatus() {
    return request<ResourceStoreStatus>('/resources/status')
  },

  search(query: string, options: { type?: ResourceType | ''; source?: ResourceSource | ''; privacy?: ResourcePrivacy | ''; maxPrivacy?: ResourcePrivacy | ''; tag?: string; project?: string; location?: string; fromDate?: string; toDate?: string; limit?: number } = {}) {
    const params = new URLSearchParams({ q: query })
    if (options.type) params.set('type', options.type)
    if (options.source) params.set('source', options.source)
    if (options.privacy) params.set('privacy', options.privacy)
    if (options.maxPrivacy) params.set('maxPrivacy', options.maxPrivacy)
    if (options.tag) params.set('tag', options.tag)
    if (options.project) params.set('project', options.project)
    if (options.location) params.set('location', options.location)
    if (options.fromDate) params.set('fromDate', options.fromDate)
    if (options.toDate) params.set('toDate', options.toDate)
    if (options.limit) params.set('limit', String(options.limit))
    return request<ResourceSearchResult[]>(`/resources/search?${params.toString()}`)
  },

  getResource(id: string) {
    return request<Resource>(`/resources/${encodeURIComponent(id)}`)
  },

  list(options: { type?: ResourceType | ''; source?: ResourceSource | ''; privacy?: ResourcePrivacy | ''; archived?: boolean; tag?: string; project?: string; location?: string; fromDate?: string; toDate?: string; offset?: number; limit?: number } = {}) {
    const params = new URLSearchParams()
    if (options.type) params.set('type', options.type)
    if (options.source) params.set('source', options.source)
    if (options.privacy) params.set('privacy', options.privacy)
    if (options.archived !== undefined) params.set('archived', String(options.archived))
    if (options.tag) params.set('tag', options.tag)
    if (options.project) params.set('project', options.project)
    if (options.location) params.set('location', options.location)
    if (options.fromDate) params.set('fromDate', options.fromDate)
    if (options.toDate) params.set('toDate', options.toDate)
    if (options.offset !== undefined) params.set('offset', String(options.offset))
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    return request<{ items: ResourceSummary[]; total: number; offset: number; limit: number }>(`/resources${params.size ? `?${params.toString()}` : ''}`)
  },

  syncAll() {
    return request<{ results: Record<string, unknown>; errors: Record<string, string>; completedAt: string }>('/resources/sync/all', { method: 'POST' }, 120_000)
  },

  syncXiaomi(mode: 'auto' | ResourceSyncMode = 'auto') {
    return request<Record<string, unknown>>(`/resources/sync/xiaomi-notes?mode=${mode}`, { method: 'POST' }, 120_000)
  },

  getConflicts(status: 'all' | 'unresolved' | 'resolved' = 'unresolved') {
    return request<ResourceConflictSummary[]>(`/resources/conflicts?status=${status}`)
  },

  getConflict(id: string) {
    return request<ResourceConflictVersion>(`/resources/conflicts/${encodeURIComponent(id)}`)
  },

  resolveConflict(id: string, resolution: ResourceConflictResolution) {
    return request<ResourceConflictVersion>(`/resources/conflicts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution })
    })
  }
}
