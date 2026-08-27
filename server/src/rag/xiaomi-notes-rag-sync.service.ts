import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { XiaomiNotesService } from '../xiaomi-notes/xiaomi-notes.service'
import type { RagSourceSyncStatus } from './rag.model'
import { RagService } from './rag.service'

type TargetOperation = 'upsert' | 'delete'

const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000 // 每 15 分钟自动静默扫描一次

@Injectable()
export class XiaomiNotesRagSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(XiaomiNotesRagSyncService.name)
  private status: RagSourceSyncStatus = this.idleStatus()
  private runner?: Promise<void>
  private pendingFull = false
  private readonly pendingItems = new Map<string, TargetOperation>()
  private cancelRequested = false
  private autoRetryConsumed = false
  private autoSyncTimer?: NodeJS.Timeout

  constructor(
    private readonly xiaomiNotes: XiaomiNotesService,
    private readonly rag: RagService
  ) {}

  onModuleInit() {
    // 启动 8 秒后首次静默同步，避免阻塞核心启动流程
    setTimeout(() => {
      void this.runSilentSyncIfConfigured()
    }, 8000)

    // 每 15 分钟定期静默增量同步
    this.autoSyncTimer = setInterval(() => {
      void this.runSilentSyncIfConfigured()
    }, AUTO_SYNC_INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = undefined
    }
  }

  private async runSilentSyncIfConfigured() {
    try {
      const xiaomiStatus = this.xiaomiNotes.getStatus()
      if (!xiaomiStatus.configured || xiaomiStatus.mode !== 'ready') return
      const ragSettings = await this.rag.getSettings()
      if (!ragSettings.settings.autoSyncXiaomi) return

      // 仅在当前空闲时触发静默同步
      if (this.status.state === 'idle' && !this.runner) {
        this.logger.log('Executing scheduled background sync for Xiaomi Notes...')
        await this.requestFullSync()
      }
    } catch (err: any) {
      this.logger.debug(`Silent background sync skipped: ${err.message}`)
    }
  }

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
const MAX_SYNC_DETAILS_PER_RUN = 30 // 单次同步最多拉取 30 篇有变更笔记的详情，避免网络风暴与高延迟

    let pageNumber = 0
    let detailFetchCount = 0
    try {
      while (true) {
        if (this.cancelRequested) return this.finishCancelled()
        pageNumber += 1
        if (pageNumber > 10_000) throw new Error('Xiaomi notes scan exceeded the page safety limit')
        this.status.currentPage = pageNumber
        const page = await this.xiaomiNotes.findPage({ cursor, limit: 100, forceRefresh: false })
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

          // 限制单次详情抓取数量，超出部分保留在下一轮增量处理
          if (detailFetchCount >= MAX_SYNC_DETAILS_PER_RUN) {
            this.status.skipped += 1
            this.status.processed += 1
            this.pendingFull = true
            continue
          }

          try {
            detailFetchCount += 1
            // 优先从本地缓存获取详情，本地缓存缺失时才请求远端
            const detail = await this.xiaomiNotes.findOne(note.id, false)
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
        if (page.lastPage || detailFetchCount >= MAX_SYNC_DETAILS_PER_RUN) break
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
