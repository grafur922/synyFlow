import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { DenseVectorMatch, DenseVectorRecord, DenseVectorSearchOptions, VectorStore, VectorStoreStatus } from './vector-store'

type LanceConnection = {
  tableNames(): Promise<string[]>
  createTable(name: string, data: unknown[]): Promise<LanceTable>
  openTable(name: string): Promise<LanceTable>
  dropTable(name: string): Promise<void>
}
type LanceTable = {
  add(data: unknown[]): Promise<void>
  delete(predicate: string): Promise<void>
  vectorSearch(vector: number[]): { limit(value: number): { toArray(): Promise<Record<string, unknown>[]> } }
}
type LanceModule = { connect(path: string): Promise<LanceConnection> }
type VectorManifest = { format: 'terra-rag-vector-manifest'; version: 1; activeVersion?: string; pendingVersion?: string; namespaces: Record<string, { table: string; dimensions: number; updatedAt: number }> }

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>

@Injectable()
export class LanceDbVectorStore implements VectorStore {
  private readonly rootPath = resolve(process.env.TERRA_RAG_VECTOR_PATH || join(process.cwd(), 'data', 'rag-vectors'))
  private readonly manifestPath = join(this.rootPath, 'vector-manifest.json')
  private module?: LanceModule
  private connection?: LanceConnection
  private packageInstalled = false
  private lastError = ''

  async getStatus(): Promise<VectorStoreStatus> {
    let manifest = this.emptyManifest()
    try {
      const connection = await this.getConnection()
      manifest = await this.readManifest()
      const names = await connection.tableNames()
      this.lastError = ''
      return {
        available: true,
        packageInstalled: true,
        path: this.rootPath,
        activeVersion: manifest.activeVersion,
        pendingVersion: manifest.pendingVersion,
        namespaces: Object.keys(manifest.namespaces).filter((version) => names.includes(manifest.namespaces[version].table)),
        message: 'LanceDB vector storage is available'
      }
    } catch (error) {
      this.lastError = this.safeError(error)
      return {
        available: false,
        packageInstalled: this.packageInstalled,
        path: this.rootPath,
        activeVersion: manifest.activeVersion,
        pendingVersion: manifest.pendingVersion,
        namespaces: Object.keys(manifest.namespaces),
        message: this.lastError || 'LanceDB vector storage is unavailable',
        lastError: this.lastError || undefined
      }
    }
  }

  async upsert(version: string, records: DenseVectorRecord[]) {
    if (!records.length) return
    this.validateVersion(version)
    const dimensions = records[0].vector.length
    if (!dimensions || records.some((record) => record.vectorVersion !== version || record.vector.length !== dimensions)) {
      throw new Error('Dense vector batch is invalid')
    }
    const connection = await this.getConnection()
    const manifest = await this.readManifest()
    const tableName = this.tableName(version)
    const names = await connection.tableNames()
    const rows = records.map((record) => ({
      chunk_id: record.chunkId,
      document_id: record.documentId,
      content_hash: record.contentHash,
      privacy: record.privacy,
      injection_risk: record.injectionRisk,
      vector_version: version,
      vector: record.vector
    }))
    let table: LanceTable
    if (names.includes(tableName)) {
      table = await connection.openTable(tableName)
      await table.delete(this.inPredicate('chunk_id', records.map((record) => record.chunkId)))
      await table.add(rows)
    } else {
      table = await connection.createTable(tableName, rows)
    }
    manifest.namespaces[version] = { table: tableName, dimensions, updatedAt: Date.now() }
    manifest.pendingVersion = version === manifest.activeVersion ? undefined : version
    await this.writeManifest(manifest)
    this.lastError = ''
  }

  async search(version: string, query: number[], options: DenseVectorSearchOptions): Promise<DenseVectorMatch[]> {
    this.validateVersion(version)
    if (!query.length || !query.every(Number.isFinite)) throw new Error('Dense query vector is invalid')
    const connection = await this.getConnection()
    const manifest = await this.readManifest()
    const namespace = manifest.namespaces[version]
    if (!namespace || namespace.dimensions !== query.length) return []
    const names = await connection.tableNames()
    if (!names.includes(namespace.table)) return []
    const table = await connection.openTable(namespace.table)
    const candidates = await table.vectorSearch(query).limit(Math.max(options.limit * 8, 32)).toArray()
    const allowedDocuments = options.documentIds?.length ? new Set(options.documentIds) : undefined
    return candidates.flatMap((row): DenseVectorMatch[] => {
      const chunkId = String(row.chunk_id || '')
      const documentId = String(row.document_id || '')
      const privacy = String(row.privacy || '')
      const injectionRisk = String(row.injection_risk || '')
      const distance = Number(row._distance)
      if (!/^[a-f0-9]{32}$/.test(chunkId) || !documentId || !Number.isFinite(distance)) return []
      if (allowedDocuments && !allowedDocuments.has(documentId)) return []
      if (privacy === 'secret' || (options.maxPrivacy === 'public' && privacy !== 'public')) return []
      if (!options.includeFlagged && injectionRisk === 'high') return []
      return [{ chunkId, documentId, distance, score: 1 / (1 + Math.max(0, distance)) }]
    }).slice(0, options.limit)
  }

  async deleteByDocumentIds(version: string, documentIds: string[]) {
    await this.deleteWhere(version, 'document_id', documentIds)
  }

  async deleteByChunkIds(version: string, chunkIds: string[]) {
    await this.deleteWhere(version, 'chunk_id', chunkIds)
  }

  async clearVersion(version: string) {
    this.validateVersion(version)
    const connection = await this.getConnection()
    const manifest = await this.readManifest()
    const namespace = manifest.namespaces[version]
    if (namespace) {
      const names = await connection.tableNames()
      if (names.includes(namespace.table)) await connection.dropTable(namespace.table)
      delete manifest.namespaces[version]
      if (manifest.activeVersion === version) manifest.activeVersion = undefined
      if (manifest.pendingVersion === version) manifest.pendingVersion = undefined
      await this.writeManifest(manifest)
    }
  }

  async activateVersion(version: string) {
    this.validateVersion(version)
    const connection = await this.getConnection()
    const manifest = await this.readManifest()
    const namespace = manifest.namespaces[version]
    if (!namespace || !(await connection.tableNames()).includes(namespace.table)) throw new Error('Dense vector namespace is not ready')
    manifest.activeVersion = version
    manifest.pendingVersion = undefined
    await this.writeManifest(manifest)
  }

  private async deleteWhere(version: string, field: 'document_id' | 'chunk_id', values: string[]) {
    if (!values.length) return
    this.validateVersion(version)
    const connection = await this.getConnection()
    const manifest = await this.readManifest()
    const namespace = manifest.namespaces[version]
    if (!namespace || !(await connection.tableNames()).includes(namespace.table)) return
    const table = await connection.openTable(namespace.table)
    await table.delete(this.inPredicate(field, values))
    namespace.updatedAt = Date.now()
    await this.writeManifest(manifest)
  }

  private async getConnection() {
    if (this.connection) return this.connection
    await mkdir(this.rootPath, { recursive: true })
    if (!this.module) {
      try {
        const loaded = await dynamicImport('@lancedb/lancedb') as Partial<LanceModule>
        if (typeof loaded.connect !== 'function') throw new Error('LanceDB package has an incompatible API')
        this.module = loaded as LanceModule
        this.packageInstalled = true
      } catch (error) {
        this.packageInstalled = false
        throw new Error(`LanceDB package is unavailable: ${this.safeError(error)}`)
      }
    }
    this.connection = await this.module.connect(this.rootPath)
    return this.connection
  }

  private async readManifest(): Promise<VectorManifest> {
    try {
      const parsed = JSON.parse(await readFile(this.manifestPath, 'utf8')) as VectorManifest
      if (parsed.format !== 'terra-rag-vector-manifest' || parsed.version !== 1 || !parsed.namespaces || typeof parsed.namespaces !== 'object') throw new Error()
      return parsed
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return this.emptyManifest()
      throw new Error('Vector manifest is invalid or unreadable')
    }
  }

  private async writeManifest(manifest: VectorManifest) {
    await mkdir(this.rootPath, { recursive: true })
    const tempPath = `${this.manifestPath}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try { await rename(tempPath, this.manifestPath) }
    catch (error) { await rm(tempPath, { force: true }).catch(() => undefined); throw error }
  }

  private emptyManifest(): VectorManifest {
    return { format: 'terra-rag-vector-manifest', version: 1, namespaces: {} }
  }

  private tableName(version: string) {
    return `rag_vectors_${createHash('sha256').update(version).digest('hex').slice(0, 20)}`
  }

  private inPredicate(field: string, values: string[]) {
    if (!values.length) return 'false'
    return `${field} IN (${values.map((value) => `'${this.escapeSql(value)}'`).join(', ')})`
  }

  private escapeSql(value: string) {
    if (value.length > 300 || /[\0\r\n]/.test(value)) throw new Error('Vector metadata identifier is invalid')
    return value.replace(/'/g, "''")
  }

  private validateVersion(version: string) {
    if (!version || version.length > 300 || /[\0\r\n]/.test(version)) throw new Error('Vector version is invalid')
  }

  private safeError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Vector storage failed'
    return message.replace(/[\r\n]/g, ' ').slice(0, 240)
  }
}

