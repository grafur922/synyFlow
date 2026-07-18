import type {
  SaveXiaomiNoteInput,
  XiaomiConnectorStatus,
  XiaomiNote,
  XiaomiNoteHistoryArchiveItem,
  XiaomiNoteHistoryEntry,
  XiaomiNoteHistorySummary,
  XiaomiNotePage,
  XiaomiNoteMetadata,
  UpdateXiaomiNoteMetadataInput
} from '../shared/xiaomiNote'

const configuredBase = (import.meta.env.VITE_TERRA_API_URL as string | undefined)?.replace(/\/$/, '')
const apiPrefix = configuredBase ? `${configuredBase}/api` : '/api'
const REQUEST_TIMEOUT_MS = 15_000

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const headers = new Headers(init?.headers)

  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  try {
    const response = await fetch(`${apiPrefix}${path}`, { ...init, headers, signal: controller.signal })
    const text = await response.text()

    if (!response.ok) {
      let message = response.statusText
      try {
        const payload = JSON.parse(text) as { message?: string | string[] }
        message = Array.isArray(payload.message) ? payload.message.join('；') : payload.message || message
      } catch {
        if (text) message = text.slice(0, 200)
      }
      throw new Error(message || '请求失败')
    }

    return text ? JSON.parse(text) as T : undefined as T
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw new Error('请求超时，请检查后端和网络连接')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export const xiaomiNotesApi = {
  getStatus: () => request<XiaomiConnectorStatus>('/xiaomi-notes/status'),

  saveCredentials: (cookie: string) => request<XiaomiConnectorStatus>('/xiaomi-notes/credentials', {
    method: 'POST',
    body: JSON.stringify({ cookie })
  }),

  getAudit: () => request<Array<{
    at: number
    operation: string
    outcome: 'success' | 'failure' | 'blocked'
    durationMs: number
    targetHash: string
    errorClass?: string
  }>>('/xiaomi-notes/audit'),

  getNotes(options: { cursor?: string; limit?: number; refresh?: boolean } = {}) {
    const query = new URLSearchParams()
    if (options.cursor) query.set('cursor', options.cursor)
    if (options.limit) query.set('limit', String(options.limit))
    if (options.refresh) query.set('refresh', 'true')
    return request<XiaomiNotePage>(`/xiaomi-notes${query.size ? `?${query.toString()}` : ''}`)
  },

  getNote: (id: string) => request<XiaomiNote>(`/xiaomi-notes/${encodeURIComponent(id)}`),

  createNote(input: SaveXiaomiNoteInput) {
    return request<XiaomiNote>('/xiaomi-notes', { method: 'POST', body: JSON.stringify(input) })
  },

  updateNote(id: string, input: SaveXiaomiNoteInput) {
    return request<XiaomiNote>(`/xiaomi-notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  },

  deleteNote(id: string) {
    return request<{ id: string; deleted: boolean }>(`/xiaomi-notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  getMetadataStatus() {
    return request<{ available: boolean; encryptedAtRest: boolean; encryptionConfigured: boolean; format: string; message: string }>('/xiaomi-notes/metadata/status')
  },

  getAllMetadata() {
    return request<XiaomiNoteMetadata[]>('/xiaomi-notes/metadata')
  },

  getMetadata(id: string) {
    return request<XiaomiNoteMetadata>(`/xiaomi-notes/metadata/${encodeURIComponent(id)}`)
  },

  updateMetadata(id: string, input: UpdateXiaomiNoteMetadataInput) {
    return request<XiaomiNoteMetadata>(`/xiaomi-notes/metadata/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    })
  },

  getHistoryArchive() {
    return request<XiaomiNoteHistoryArchiveItem[]>('/xiaomi-notes/history/archive')
  },

  recreateFromHistory(historyId: string) {
    return request<XiaomiNote>(`/xiaomi-notes/history/archive/${encodeURIComponent(historyId)}/recreate`, { method: 'POST' })
  },

  getHistory(id: string) {
    return request<XiaomiNoteHistorySummary[]>(`/xiaomi-notes/${encodeURIComponent(id)}/history`)
  },

  getHistoryVersion(id: string, historyId: string) {
    return request<XiaomiNoteHistoryEntry>(`/xiaomi-notes/${encodeURIComponent(id)}/history/${encodeURIComponent(historyId)}`)
  },

  createCheckpoint(id: string) {
    return request<XiaomiNoteHistoryEntry>(`/xiaomi-notes/${encodeURIComponent(id)}/history`, { method: 'POST' })
  },

  restoreHistory(id: string, historyId: string) {
    return request<XiaomiNote>(`/xiaomi-notes/${encodeURIComponent(id)}/history/${encodeURIComponent(historyId)}/restore`, { method: 'POST' })
  },

  deleteHistoryVersion(id: string, historyId: string) {
    return request<{ noteId: string; historyId: string; removed: boolean }>(`/xiaomi-notes/${encodeURIComponent(id)}/history/${encodeURIComponent(historyId)}`, { method: 'DELETE' })
  },

  clearHistory(id: string) {
    return request<{ noteId: string; removed: number }>(`/xiaomi-notes/${encodeURIComponent(id)}/history`, { method: 'DELETE' })
  }
}
