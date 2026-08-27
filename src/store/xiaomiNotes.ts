import { defineStore } from 'pinia'
import { xiaomiNotesApi } from '../services/xiaomiNotesApi'
import { ragApi } from '../services/ragApi'
import type {
  SaveXiaomiNoteInput,
  XiaomiConnectorStatus,
  XiaomiNote,
  XiaomiNoteFolder,
  XiaomiNoteHistoryArchiveItem,
  XiaomiNoteHistoryEntry,
  XiaomiNoteHistorySummary,
  XiaomiNoteMetadata,
  UpdateXiaomiNoteMetadataInput
} from '../shared/xiaomiNote'

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误'
}

const STORAGE_KEYS = {
  notes: 'synyflow_cached_xiaomi_notes_v1',
  folders: 'synyflow_cached_xiaomi_folders_v1',
  metadata: 'synyflow_cached_xiaomi_metadata_v1',
  status: 'synyflow_cached_xiaomi_status_v1',
  selectedNote: 'synyflow_cached_xiaomi_selected_note_v1'
}

function loadCachedJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function saveCachedJson<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // ignore
  }
}

export const useXiaomiNotesStore = defineStore('xiaomiNotes', {
  state: () => ({
    notes: loadCachedJson<XiaomiNote[]>(STORAGE_KEYS.notes, []),
    folders: loadCachedJson<XiaomiNoteFolder[]>(STORAGE_KEYS.folders, []),
    historyArchive: [] as XiaomiNoteHistoryArchiveItem[],
    metadata: loadCachedJson<Record<string, XiaomiNoteMetadata>>(STORAGE_KEYS.metadata, {}),
    metadataStatus: undefined as { available: boolean; encryptedAtRest: boolean; encryptionConfigured: boolean; format: string; message: string } | undefined,
    selectedNote: loadCachedJson<XiaomiNote | undefined>(STORAGE_KEYS.selectedNote, undefined),
    status: loadCachedJson<XiaomiConnectorStatus | undefined>(STORAGE_KEYS.status, undefined),
    nextCursor: undefined as string | undefined,
    lastPage: true,
    history: [] as XiaomiNoteHistorySummary[],
    selectedHistory: undefined as XiaomiNoteHistoryEntry | undefined,
    loading: false,
    loadingMore: false,
    loadingDetail: false,
    loadingHistory: false,
    loadingArchive: false,
    savingMetadata: false,
    savingCredentials: false,
    deletingHistory: false,
    saving: false,
    restoring: false,
    error: '',
    historyError: '',
    initialized: false,
    listRequestId: 0,
    detailRequestId: 0,
    historyRequestId: 0
  }),

  getters: {
    configured: (state) => Boolean(state.status?.configured),
    writable: (state) => Boolean(state.status?.writable),
    sortedNotes: (state) => [...state.notes].sort((a, b) => b.modifyDate - a.modifyDate)
  },

  actions: {
    async initialize() {
      if (this.initialized) return
      this.initialized = true
      await Promise.all([this.refreshStatus(), this.loadMetadata()])
      if (this.status?.configured) {
        await this.loadNotes(true)
      }
    },

    async refreshStatus() {
      try {
        this.status = await xiaomiNotesApi.getStatus()
        saveCachedJson(STORAGE_KEYS.status, this.status)
      } catch (error) {
        this.status = {
          configured: false,
          writable: false,
          mode: 'unconfigured',
          credentialSource: 'none',
          credentialWritable: false,
          cacheTtlSeconds: 0,
          message: '无法连接 synyFlow 后端',
          consecutiveFailures: 0,
          audit: { retainedEvents: 0 },
          passportRefresh: {
            configured: false,
            source: 'none',
            writable: false,
            available: false,
            refreshing: false,
            message: '无法连接 synyFlow 后端'
          }
        }
        this.error = messageFrom(error)
      }
    },

    async saveCredentials(cookie: string) {
      if (this.savingCredentials) return false
      this.savingCredentials = true
      this.error = ''
      try {
        this.status = await xiaomiNotesApi.saveCredentials(cookie)
        saveCachedJson(STORAGE_KEYS.status, this.status)
        this.initialized = true
        if (this.status.configured) await this.loadNotes(true, true)
        return true
      } catch (error) {
        this.error = messageFrom(error)
        return false
      } finally {
        this.savingCredentials = false
      }
    },

    async loadNotes(reset = true, forceRefresh = false) {
      if (this.loading || this.loadingMore) return
      const requestId = ++this.listRequestId
      this.error = ''
      // 若本地已有笔记，绝不展示全屏阻断性 loading，实现零等待直接可用
      if (reset && this.notes.length === 0) this.loading = true
      else if (!reset) this.loadingMore = true

      try {
        const page = await xiaomiNotesApi.getNotes({
          cursor: reset ? undefined : this.nextCursor,
          limit: 30,
          refresh: forceRefresh
        })
        if (requestId !== this.listRequestId) return
        const merged = reset ? page.notes : [...this.notes, ...page.notes]
        this.notes = Array.from(new Map(merged.map((note) => [note.id, note])).values())
        const mergedFolders = reset ? page.folders : [...this.folders, ...page.folders]
        this.folders = Array.from(new Map(mergedFolders.map((folder) => [folder.id, folder])).values())
        this.nextCursor = page.nextCursor
        this.lastPage = page.lastPage
        saveCachedJson(STORAGE_KEYS.notes, this.notes)
        saveCachedJson(STORAGE_KEYS.folders, this.folders)
        if (reset && forceRefresh) void ragApi.getSettings().then((result) => result.settings.autoSyncXiaomi ? ragApi.syncXiaomiNotes() : undefined).catch(() => undefined)
      } catch (error) {
        if (requestId === this.listRequestId) this.error = messageFrom(error)
      } finally {
        if (requestId === this.listRequestId) {
          this.loading = false
          this.loadingMore = false
        }
      }
    },

    async selectNote(id: string) {
      const requestId = ++this.detailRequestId
      this.loadingDetail = true
      this.error = ''
      this.clearHistory()
      try {
        const note = await xiaomiNotesApi.getNote(id)
        if (requestId !== this.detailRequestId) return undefined
        this.selectedNote = note
        saveCachedJson(STORAGE_KEYS.selectedNote, note)
        this.upsertSummary(note)
        return note
      } catch (error) {
        if (requestId === this.detailRequestId) this.error = messageFrom(error)
        return undefined
      } finally {
        if (requestId === this.detailRequestId) this.loadingDetail = false
      }
    },

    clearSelection() {
      this.detailRequestId += 1
      this.selectedNote = undefined
      this.loadingDetail = false
      this.clearHistory()
    },

    async createNote(input: SaveXiaomiNoteInput) {
      this.saving = true
      this.error = ''
      try {
        const note = await xiaomiNotesApi.createNote(input)
        this.selectedNote = note
        this.upsertSummary(note)
        this.clearHistory()
        return note
      } catch (error) {
        this.error = messageFrom(error)
        return undefined
      } finally {
        this.saving = false
      }
    },

    async updateNote(id: string, input: SaveXiaomiNoteInput) {
      this.saving = true
      this.error = ''
      try {
        const note = await xiaomiNotesApi.updateNote(id, input)
        this.selectedNote = note
        this.upsertSummary(note)
        if (this.history.length) await this.loadHistory(id)
        return note
      } catch (error) {
        this.error = messageFrom(error)
        return undefined
      } finally {
        this.saving = false
      }
    },

    async deleteNote(id: string) {
      this.saving = true
      this.error = ''
      try {
        await xiaomiNotesApi.deleteNote(id)
        this.notes = this.notes.filter((note) => note.id !== id)
        if (this.selectedNote?.id === id) this.selectedNote = undefined
        this.clearHistory()
        return true
      } catch (error) {
        this.error = messageFrom(error)
        return false
      } finally {
        this.saving = false
      }
    },

    async loadMetadata() {
      try {
        const [status, entries] = await Promise.all([
          xiaomiNotesApi.getMetadataStatus(),
          xiaomiNotesApi.getAllMetadata()
        ])
        this.metadataStatus = status
        this.metadata = Object.fromEntries(entries.map((entry) => [entry.noteId, entry]))
      } catch (error) {
        this.error = messageFrom(error)
      }
    },

    async updateMetadata(noteId: string, patch: UpdateXiaomiNoteMetadataInput) {
      this.savingMetadata = true
      this.error = ''
      try {
        const metadata = await xiaomiNotesApi.updateMetadata(noteId, patch)
        this.metadata[noteId] = metadata
        return metadata
      } catch (error) {
        this.error = messageFrom(error)
        return undefined
      } finally {
        this.savingMetadata = false
      }
    },

    async loadHistoryArchive() {
      this.loadingArchive = true
      this.historyError = ''
      try {
        this.historyArchive = await xiaomiNotesApi.getHistoryArchive()
      } catch (error) {
        this.historyError = messageFrom(error)
      } finally {
        this.loadingArchive = false
      }
    },

    async recreateFromHistory(historyId: string) {
      this.restoring = true
      this.historyError = ''
      try {
        const note = await xiaomiNotesApi.recreateFromHistory(historyId)
        this.selectedNote = note
        this.upsertSummary(note)
        await this.loadHistoryArchive()
        return note
      } catch (error) {
        this.historyError = messageFrom(error)
        return undefined
      } finally {
        this.restoring = false
      }
    },

    async loadHistory(noteId: string) {
      const requestId = ++this.historyRequestId
      this.loadingHistory = true
      this.historyError = ''
      this.selectedHistory = undefined
      try {
        const entries = await xiaomiNotesApi.getHistory(noteId)
        if (requestId === this.historyRequestId) this.history = entries
      } catch (error) {
        if (requestId === this.historyRequestId) this.historyError = messageFrom(error)
      } finally {
        if (requestId === this.historyRequestId) this.loadingHistory = false
      }
    },

    async loadHistoryVersion(noteId: string, historyId: string) {
      const requestId = ++this.historyRequestId
      this.loadingHistory = true
      this.historyError = ''
      try {
        const entry = await xiaomiNotesApi.getHistoryVersion(noteId, historyId)
        if (requestId === this.historyRequestId) this.selectedHistory = entry
        return entry
      } catch (error) {
        if (requestId === this.historyRequestId) this.historyError = messageFrom(error)
        return undefined
      } finally {
        if (requestId === this.historyRequestId) this.loadingHistory = false
      }
    },

    async createCheckpoint(noteId: string) {
      this.loadingHistory = true
      this.historyError = ''
      try {
        await xiaomiNotesApi.createCheckpoint(noteId)
        await this.loadHistory(noteId)
        return true
      } catch (error) {
        this.historyError = messageFrom(error)
        return false
      } finally {
        this.loadingHistory = false
      }
    },

    async restoreHistory(noteId: string, historyId: string) {
      this.restoring = true
      this.historyError = ''
      try {
        const note = await xiaomiNotesApi.restoreHistory(noteId, historyId)
        this.selectedNote = note
        this.upsertSummary(note)
        await this.loadHistory(noteId)
        return note
      } catch (error) {
        this.historyError = messageFrom(error)
        return undefined
      } finally {
        this.restoring = false
      }
    },

    async deleteHistoryVersion(noteId: string, historyId: string) {
      this.deletingHistory = true
      this.historyError = ''
      try {
        await xiaomiNotesApi.deleteHistoryVersion(noteId, historyId)
        this.history = this.history.filter((entry) => entry.id !== historyId)
        if (this.selectedHistory?.id === historyId) this.selectedHistory = undefined
        await this.loadHistoryArchive()
        return true
      } catch (error) {
        this.historyError = messageFrom(error)
        return false
      } finally {
        this.deletingHistory = false
      }
    },

    async clearNoteHistory(noteId: string) {
      this.deletingHistory = true
      this.historyError = ''
      try {
        const result = await xiaomiNotesApi.clearHistory(noteId)
        this.clearHistory()
        await this.loadHistoryArchive()
        return result.removed
      } catch (error) {
        this.historyError = messageFrom(error)
        return undefined
      } finally {
        this.deletingHistory = false
      }
    },

    clearHistory() {
      this.historyRequestId += 1
      this.history = []
      this.selectedHistory = undefined
      this.loadingHistory = false
      this.historyError = ''
    },

    upsertSummary(note: XiaomiNote) {
      const summary: XiaomiNote = { ...note }
      delete summary.content
      const next = [summary, ...this.notes.filter((item) => item.id !== note.id)]
      next.sort((a, b) => (b.modifyDate || 0) - (a.modifyDate || 0))
      this.notes = next
    }
  }
})
