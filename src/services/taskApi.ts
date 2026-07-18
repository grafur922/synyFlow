import type { CreateTaskInput, Task, UpdateTaskInput } from '../shared/task'

export type TaskEvent =
  | { type: 'created' | 'updated'; task: Task; timestamp: string }
  | { type: 'deleted'; id: string; timestamp: string }
  | { type: 'cleared'; timestamp: string }
  | { type: 'snapshot'; tasks: Task[]; timestamp: string }

const apiBaseUrl = (import.meta.env.VITE_TERRA_API_URL as string | undefined)?.replace(/\/$/, '')
const REQUEST_TIMEOUT_MS = 10_000

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error('VITE_TERRA_API_URL is not configured')
  }

  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${apiBaseUrl}/api${path}`, {
      ...init,
      headers,
      signal: controller.signal
    })

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText)
      throw new Error(message || response.statusText)
    }

    if (response.status === 204) {
      return undefined as T
    }

    const text = await response.text()
    return text ? (JSON.parse(text) as T) : (undefined as T)
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error('Todo backend request timed out')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export const taskApi = {
  isConfigured: Boolean(apiBaseUrl),

  getTasks() {
    return request<Task[]>('/tasks')
  },

  replaceTasks(tasks: Task[]) {
    return request<Task[]>('/tasks', {
      method: 'PUT',
      body: JSON.stringify(tasks)
    })
  },

  createTask(task: CreateTaskInput) {
    return request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(task)
    })
  },

  updateTask(id: string, task: UpdateTaskInput) {
    return request<Task>(`/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(task)
    })
  },

  toggleTaskCompleted(id: string) {
    return request<Task>(`/tasks/${encodeURIComponent(id)}/toggle`, {
      method: 'PATCH'
    })
  },

  deleteTask(id: string) {
    return request<void>(`/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  },

  clearTasks() {
    return request<void>('/tasks', {
      method: 'DELETE'
    })
  }
}

export function subscribeToTaskEvents(
  onMessage: (event: TaskEvent) => void,
  onError?: () => void
) {
  if (!apiBaseUrl || typeof EventSource === 'undefined') {
    return undefined
  }

  const source = new EventSource(`${apiBaseUrl}/api/tasks/events/stream`)

  source.onmessage = (message) => {
    try {
      onMessage(JSON.parse(message.data) as TaskEvent)
    } catch (error) {
      console.warn('Failed to parse task event', error)
    }
  }

  source.onerror = () => {
    onError?.()
  }

  return source
}
