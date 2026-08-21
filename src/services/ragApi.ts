import type {
  RagDocument,
  RagDocumentSummary,
  RagEmbeddingCredentialStatus,
  RagEmbeddingSettings,
  RagMimeType,
  RagPrivacy,
  RagQueryProvider,
  RagQueryResult,
  RagSettingsResult,
  RagStatus,
  RagVectorIndexStatus,
  XiaomiRagSyncStatus
} from '../shared/rag'

const configuredBase = (import.meta.env.VITE_TERRA_API_URL as string | undefined)?.replace(/\/$/, '')
const apiPrefix = configuredBase ? `${configuredBase}/api` : '/api'

async function request<T>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
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

function parseError(text: string, fallback: string) {
  try {
    const payload = JSON.parse(text) as { message?: string | string[] | { message?: string } }
    if (Array.isArray(payload.message)) return payload.message.join('；')
    if (typeof payload.message === 'string') return payload.message
    if (payload.message?.message) return payload.message.message
  } catch { if (text) return text.slice(0, 200) }
  return fallback || '请求失败'
}

export const ragApi = {
  getStatus: () => request<RagStatus>('/rag/status'),
  getSettings: () => request<RagSettingsResult>('/rag/settings'),
  updateSettings(input: Partial<Pick<RagEmbeddingSettings, 'enabled' | 'baseUrl' | 'model' | 'dimensions' | 'batchSize' | 'timeoutMs' | 'autoSyncXiaomi' | 'xiaomiDefaultPrivacy' | 'autoRetry' | 'dailyTokenBudget'>>) {
    return request<RagSettingsResult>('/rag/settings', { method: 'PATCH', body: JSON.stringify(input) })
  },
  saveEmbeddingCredential(apiKey: string) {
    return request<RagEmbeddingCredentialStatus>('/rag/embedding/credentials', { method: 'POST', body: JSON.stringify({ apiKey }) })
  },
  deleteEmbeddingCredential() {
    return request<RagEmbeddingCredentialStatus>('/rag/embedding/credentials', { method: 'DELETE' })
  },
  testEmbedding() {
    return request<{ ok: true; provider: string; model: string; dimensions: number; latencyMs: number }>('/rag/embedding/test', { method: 'POST' }, 60_000)
  },
  getXiaomiSyncStatus: () => request<XiaomiRagSyncStatus>('/rag/sources/xiaomi/status'),
  syncXiaomiNotes: () => request<XiaomiRagSyncStatus>('/rag/sources/xiaomi/sync', { method: 'POST' }),
  retryXiaomiSync: () => request<XiaomiRagSyncStatus>('/rag/sources/xiaomi/retry', { method: 'POST' }),
  cancelXiaomiSync: () => request<XiaomiRagSyncStatus>('/rag/sources/xiaomi/cancel', { method: 'POST' }),
  getVectorIndexStatus: () => request<RagVectorIndexStatus>('/rag/vector-index/status'),
  rebuildVectorIndex: () => request<{ ok: true; version: string; documents: number; vectorized: number }>('/rag/vector-index/rebuild', { method: 'POST' }, 10 * 60_000),
  getDocuments: () => request<RagDocumentSummary[]>('/rag/documents'),
  getDocument: (id: string) => request<RagDocument>(`/rag/documents/${encodeURIComponent(id)}`),
  createDocument(input: { title: string; content: string; tags: string[]; privacy: RagPrivacy; mimeType: RagMimeType; source: 'manual' | 'file'; originalFilename?: string }) {
    return request<RagDocument>('/rag/documents', { method: 'POST', body: JSON.stringify(input) })
  },
  createFromResource(resourceId: string) {
    return request<RagDocument>(`/rag/documents/from-resource/${encodeURIComponent(resourceId)}`, { method: 'POST' })
  },
  updateDocument(id: string, input: Partial<{ title: string; content: string; tags: string[]; privacy: RagPrivacy; mimeType: RagMimeType; originalFilename: string }>) {
    return request<RagDocument>(`/rag/documents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  deleteDocument(id: string) {
    return request<{ id: string; removed: boolean }>(`/rag/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  reindexDocument(id: string) {
    return request<RagDocument>(`/rag/documents/${encodeURIComponent(id)}/reindex`, { method: 'POST' }, 60_000)
  },
  reindexAll() {
    return request<{ documents: number; chunks: number; reindexedAt: number }>('/rag/reindex', { method: 'POST' }, 120_000)
  },
  query(input: { query: string; maxPrivacy: RagPrivacy; documentIds?: string[]; limit?: number; includeFlagged?: boolean; provider?: RagQueryProvider; externalConsent?: boolean }) {
    return request<RagQueryResult>('/rag/query', { method: 'POST', body: JSON.stringify(input) }, 60_000)
  }
}
