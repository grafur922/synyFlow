import type { RssItem, RssItemSummary, RssStatus, RssSubscription } from '../shared/rss'

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
    if (!response.ok) {
      let message = response.statusText
      try { message = (JSON.parse(text) as { message?: string }).message || message } catch { if (text) message = text.slice(0, 200) }
      throw new Error(message || '请求失败')
    }
    return text ? JSON.parse(text) as T : undefined as T
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw new Error('请求超时')
    throw error
  } finally { window.clearTimeout(timer) }
}

export const rssApi = {
  getStatus: () => request<RssStatus>('/rss/status'),
  getSubscriptions: () => request<RssSubscription[]>('/rss/subscriptions'),
  createSubscription(input: { url: string; title?: string; tags?: string[]; fetchNow?: boolean }) {
    return request<{ subscription: RssSubscription; importedItems: number }>('/rss/subscriptions', { method: 'POST', body: JSON.stringify(input) }, 30_000)
  },
  updateSubscription(id: string, input: { title?: string; tags?: string[]; enabled?: boolean }) {
    return request<RssSubscription>(`/rss/subscriptions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  deleteSubscription(id: string) {
    return request<{ id: string; removed: boolean }>(`/rss/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  fetchSubscription(id: string) {
    return request<{ status: number; imported: number; total?: number; unchanged: boolean }>(`/rss/subscriptions/${encodeURIComponent(id)}/fetch`, { method: 'POST' }, 30_000)
  },
  fetchAll(force = true) {
    return request<{ attempted: number; results: unknown[] }>(`/rss/fetch-all?force=${force}`, { method: 'POST' }, 120_000)
  },
  getItems(options: { subscriptionId?: string; read?: boolean; favorite?: boolean; offset?: number; limit?: number } = {}) {
    const query = new URLSearchParams()
    if (options.subscriptionId) query.set('subscriptionId', options.subscriptionId)
    if (options.read !== undefined) query.set('read', String(options.read))
    if (options.favorite !== undefined) query.set('favorite', String(options.favorite))
    if (options.offset) query.set('offset', String(options.offset))
    if (options.limit) query.set('limit', String(options.limit))
    return request<{ items: RssItemSummary[]; total: number; offset: number; limit: number }>(`/rss/items${query.size ? `?${query}` : ''}`)
  },
  getItem(id: string) {
    return request<RssItem>(`/rss/items/${encodeURIComponent(id)}`)
  },
  updateItem(id: string, input: { read?: boolean; favorite?: boolean; tags?: string[] }) {
    return request<RssItem>(`/rss/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  }
}
