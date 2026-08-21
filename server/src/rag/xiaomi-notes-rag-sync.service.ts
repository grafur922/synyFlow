import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { XiaomiNotesService } from '../xiaomi-notes/xiaomi-notes.service'
import type { RagSourceSyncStatus } from './rag.model'
import { RagService } from './rag.service'

type TargetOperation = 'upsert' | 'delete'

@Injectable()
export class XiaomiNotesRagSyncService {
  private status: RagSourceSyncStatus = this.idleStatus()
  private runner?: Promise<void>
  private pendingFull = false
  private readonly pendingItems = new Map<string, TargetOperation>()
  private cancelRequested = false
  private autoRetryConsumed = false

  constructor(
    private readonly xiaomiNotes: XiaomiNotesService,
    private readonly rag: RagService
  ) {}

  async getStatus() {
    const ledger = await this.rag.getXiaomiSyncLedger()
    return {
      ...structuredClone(this.status),
      pendingAfterCurrent: this.pendingFull || this.pendingItems.size > 0,
      ledger: {
        active: ledger.filter((entry) => entry.state === 'active').length,
        failed: ledger.filter((entry) => entry.state === 'failed').length,
        deleted: ledger.filter((entry) => entry.state === 'deleted').length
      }
    }
  }

  async requestFullSync() {
    this.autoRetryConsumed = false
    this.pendingFull = true
    this.ensureRunner()
    return { accepted: true, ...(await this.getStatus()) }
  }

  async retryFailed() {
    this.autoRetryConsumed = false
    this.pendingFull = true
    this.ensureRunner()
    return { accepted: true, ...(await this.getStatus()) }
  }

  async cancel() {
    if (this.runner) {
      this.cancelRequested = true
      this.status.state = 'cancelling'
    }
    this.pendingFull = false
    this.autoRetryConsumed = false
    return this.getStatus()
  }

  enqueueItem(noteId: string, operation: TargetOperation = 'upsert') {
    if (!noteId) return
    this.pendingItems.set(noteId, operation)
    this.ensureRunner()
  }

  private ensureRunner() {
    if (this.runner) return
    this.runner = this.runQueue().finally(() => { this.runner = undefined })
  }

  private async runQueue() {
    while (this.pendingFull || this.pendingItems.size) {
      if (this.pendingFull) {
        this.pendingFull = false
        await this.runFullSync()
        continue
      }
      const entries = [...this.pendingItems.entries()]
      this.pendingItems.clear()
      await this.runTargeted(entries)
    }
    if (this.status.state !== 'failed') {
      this.status.state = 'idle'
      this.status.finishedAt = Date.now()
    }
  }

  private async runFullSync() {
    const generation = randomUUID()
    this.cancelRequested = false
    this.status = {
      ...this.idleStatus(),
      state: 'scanning',
      startedAt: Date.now(),
      pendingAfterCurrent: this.pendingFull || this.pendingItems.size > 0
    }
    const ledger = new Map((await this.rag.getXiaomiSyncLedger()).map((entry) => [entry.sourceItemId, entry]))
    const cursors = new Set<string>()
    let cursor: string | undefined
    let pageNumber = 0
    try {
      while (true) {
        if (this.cancelRequested) return this.finishCancelled()
        pageNumber += 1
        if (pageNumber > 10_000) throw new Error('Xiaomi notes scan exceeded the page safety limit')
        this.status.currentPage = pageNumber
        const page = await this.xiaomiNotes.findPage({ cursor, limit: 200, forceRefresh: true })
        if (!page || !Array.isArray(page.notes) || typeof page.lastPage !== 'boolean') throw new Error('Xiaomi notes returned an invalid page')
        for (const note of page.notes) {
          if (this.cancelRequested) return this.finishCancelled()
          this.status.discovered += 1
          const entry = ledger.get(note.id)
          const unchanged = entry && entry.state === 'active' && entry.remoteModifyDate === note.modifyDate && String(entry.remoteTag || '') === String(note.tag || '')
          if (unchanged) {
            await this.rag.markXiaomiNoteSeen(note, generation)
            this.status.skipped += 1
            this.status.processed += 1
            continue
          }
          try {
            const detail = await this.xiaomiNotes.findOne(note.id, true)
            const result = await this.rag.upsertXiaomiNote(detail, generation)
            if (result.outcome === 'created') this.status.created += 1
            else if (result.outcome === 'updated') this.status.updated += 1
            else this.status.skipped += 1
            if (result.vectorized) this.status.vectorized += 1
            if (result.localOnly) this.status.localOnly += 1
          } catch (error) {
            this.status.failed += 1
            await this.rag.markXiaomiNoteSyncFailed(note.id, generation, error).catch(() => undefined)
          } finally {
            this.status.processed += 1
          }
        }
        if (page.lastPage) break
        const nextCursor = page.nextCursor
        if (!nextCursor || cursors.has(nextCursor)) throw new Error('Xiaomi notes pagination cursor did not advance')
        cursors.add(nextCursor)
        cursor = nextCursor
      }
      if (this.cancelRequested) return this.finishCancelled()
      this.status.state = 'indexing'
      const deletion = await this.rag.finalizeXiaomiGeneration(generation)
      this.status.deleted += deletion.deleted
      this.status.finishedAt = Date.now()
      if (this.status.failed) {
        this.status.state = 'failed'
        this.status.error = `${this.status.failed} Xiaomi note(s) failed to synchronize`
        await this.scheduleAutomaticRetry()
      } else {
        this.status.state = 'idle'
        this.status.lastSuccessAt = this.status.finishedAt
        this.status.error = undefined
        this.autoRetryConsumed = false
      }
    } catch (error) {
      this.status.state = 'failed'
      this.status.finishedAt = Date.now()
      this.status.error = this.safeError(error)
      await this.scheduleAutomaticRetry()
    }
  }

  private async runTargeted(entries: Array<[string, TargetOperation]>) {
    if (!entries.length) return
    const generation = `targeted-${randomUUID()}`
    this.status = { ...this.idleStatus(), state: 'indexing', startedAt: Date.now(), discovered: entries.length }
    for (const [noteId, operation] of entries) {
      try {
        if (operation === 'delete') {
          const result = await this.rag.removeXiaomiSourceItem(noteId)
          if (result.deleted) this.status.deleted += 1
          else this.status.skipped += 1
        } else {
          const detail = await this.xiaomiNotes.findOne(noteId, true)
          const result = await this.rag.upsertXiaomiNote(detail, generation)
          if (result.outcome === 'created') this.status.created += 1
          else if (result.outcome === 'updated') this.status.updated += 1
          else this.status.skipped += 1
          if (result.vectorized) this.status.vectorized += 1
          if (result.localOnly) this.status.localOnly += 1
        }
      } catch (error) {
        this.status.failed += 1
        this.status.error = this.safeError(error)
        await this.rag.markXiaomiNoteSyncFailed(noteId, generation, error).catch(() => undefined)
      } finally {
        this.status.processed += 1
      }
    }
    this.status.finishedAt = Date.now()
    if (this.status.failed) this.status.state = 'failed'
    else {
      this.status.state = 'idle'
      this.status.lastSuccessAt = this.status.finishedAt
    }
  }

  private async scheduleAutomaticRetry() {
    if (this.autoRetryConsumed || this.cancelRequested) return
    try {
      const settings = await this.rag.getSettings()
      if (!settings.settings.autoRetry) return
      this.autoRetryConsumed = true
      this.pendingFull = true
    } catch { /* Settings errors must not hide the original sync failure. */ }
  }

  private finishCancelled() {
    this.status.state = 'idle'
    this.status.finishedAt = Date.now()
    this.status.error = 'Sync was cancelled; missing-note deletion was not performed'
    this.cancelRequested = false
  }

  private idleStatus(): RagSourceSyncStatus {
    return {
      source: 'xiaomi-note',
      state: 'idle',
      discovered: 0,
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      failed: 0,
      vectorized: 0,
      localOnly: 0,
      pendingAfterCurrent: false
    }
  }

  private safeError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Xiaomi notes RAG sync failed'
    return message.replace(/[\r\n]/g, ' ').slice(0, 500)
  }
}
