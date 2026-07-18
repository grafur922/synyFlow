import type { BlogDraft, BlogDraftSummary, BlogPrivacy, BlogStatus, PrivacyFinding } from '../shared/blog'

const configuredBase = (import.meta.env.VITE_TERRA_API_URL as string | undefined)?.replace(/\/$/, '')
const apiPrefix = configuredBase ? `${configuredBase}/api` : '/api'

async function request<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const headers = new Headers(init?.headers); if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  try {
    const response = await fetch(`${apiPrefix}${path}`, { ...init, headers, signal: controller.signal }); const text = await response.text()
    if (!response.ok) {
      let message = response.statusText
      try {
        const payload = JSON.parse(text) as { message?: string | { message?: string } }
        message = typeof payload.message === 'string' ? payload.message : payload.message?.message || message
      } catch { if (text) message = text.slice(0, 200) }
      throw new Error(message || '请求失败')
    }
    return text ? JSON.parse(text) as T : undefined as T
  } catch (error) { if ((error as { name?: string }).name === 'AbortError') throw new Error('请求超时'); throw error }
  finally { window.clearTimeout(timer) }
}

export const blogApi = {
  getStatus: () => request<BlogStatus>('/blog/status'),
  getDrafts: () => request<BlogDraftSummary[]>('/blog/drafts'),
  getDraft: (id: string) => request<BlogDraft>(`/blog/drafts/${encodeURIComponent(id)}`),
  createDraft(input: { title: string; slug?: string; content?: string; excerpt?: string; tags?: string[]; privacy?: BlogPrivacy }) {
    return request<BlogDraft>('/blog/drafts', { method: 'POST', body: JSON.stringify(input) })
  },
  createFromXiaomi(noteId: string) {
    return request<BlogDraft>(`/blog/drafts/from-xiaomi/${encodeURIComponent(noteId)}`, { method: 'POST' }, 30_000)
  },
  updateDraft(id: string, input: Partial<{ title: string; slug: string; content: string; excerpt: string; tags: string[]; privacy: BlogPrivacy }>) {
    return request<BlogDraft>(`/blog/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  deleteDraft(id: string) { return request<{ id: string; removed: boolean }>(`/blog/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
  scan(id: string) { return request<PrivacyFinding[]>(`/blog/drafts/${encodeURIComponent(id)}/scan`) },
  preview(id: string) { return request<{ markdown: string; html: string; findings: PrivacyFinding[] }>(`/blog/drafts/${encodeURIComponent(id)}/preview`) },
  publish(id: string, acceptedFindingIds: string[]) {
    return request<{ draft: BlogDraft; findings: PrivacyFinding[]; path: string }>(`/blog/drafts/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ acceptedFindingIds }) }, 30_000)
  },
  withdraw(id: string) { return request<{ draft: BlogDraft; withdrawn: boolean; trashPath?: string }>(`/blog/drafts/${encodeURIComponent(id)}/withdraw`, { method: 'POST' }) }
}
