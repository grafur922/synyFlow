import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { CreateRagDocumentDto } from './dto/create-rag-document.dto'
import { QueryRagDto } from './dto/query-rag.dto'
import { UpdateRagDocumentDto } from './dto/update-rag-document.dto'
import { RagService } from './rag.service'
import { UpdateRagSettingsDto } from './dto/update-rag-settings.dto'
import { SaveRagEmbeddingCredentialDto } from './dto/save-rag-embedding-credential.dto'
import { isLoopbackAddress } from '../security/api-access'
import { XiaomiNotesRagSyncService } from './xiaomi-notes-rag-sync.service'

@Controller('rag')
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly xiaomiSync: XiaomiNotesRagSyncService
  ) {}

  @Get('status')
  getStatus() { return this.ragService.getStatus() }

  @Get('settings')
  getSettings() { return this.ragService.getSettings() }

  @Patch('settings')
  updateSettings(@Body() input: UpdateRagSettingsDto, @Req() request: any) {
    this.assertLoopback(request)
    return this.ragService.updateSettings(input)
  }

  @Post('embedding/credentials')
  saveEmbeddingCredential(@Body() input: SaveRagEmbeddingCredentialDto, @Req() request: any) {
    this.assertLoopback(request)
    return this.ragService.saveEmbeddingCredential(input.apiKey)
  }

  @Delete('embedding/credentials')
  removeEmbeddingCredential(@Req() request: any) {
    this.assertLoopback(request)
    return this.ragService.removeEmbeddingCredential()
  }

  @Post('embedding/test')
  testEmbeddingConnection(@Req() request: any) {
    this.assertLoopback(request)
    return this.ragService.testEmbeddingConnection()
  }

  @Post('sources/xiaomi/sync')
  syncXiaomi() { return this.xiaomiSync.requestFullSync() }

  @Get('sources/xiaomi/status')
  getXiaomiSyncStatus() { return this.xiaomiSync.getStatus() }

  @Post('sources/xiaomi/retry')
  retryXiaomiSync() { return this.xiaomiSync.retryFailed() }

  @Post('sources/xiaomi/cancel')
  cancelXiaomiSync() { return this.xiaomiSync.cancel() }

  @Get('vector-index/status')
  getVectorIndexStatus() { return this.ragService.getVectorIndexStatus() }

  @Post('vector-index/rebuild')
  rebuildVectorIndex(@Req() request: any) {
    this.assertLoopback(request)
    return this.ragService.rebuildVectorIndex()
  }

  @Get('documents')
  findAll() { return this.ragService.findAll() }

  @Post('documents')
  create(@Body() input: CreateRagDocumentDto) { return this.ragService.create(input) }

  @Post('documents/from-resource/:resourceId')
  createFromResource(@Param('resourceId') resourceId: string) { return this.ragService.createFromResource(resourceId) }

  @Get('documents/:id')
  findOne(@Param('id') id: string) { return this.ragService.findOne(id) }

  @Patch('documents/:id')
  update(@Param('id') id: string, @Body() input: UpdateRagDocumentDto) { return this.ragService.update(id, input) }

  @Delete('documents/:id')
  remove(@Param('id') id: string) { return this.ragService.remove(id) }

  @Post('documents/:id/reindex')
  reindexOne(@Param('id') id: string) { return this.ragService.reindexOne(id) }

  @Post('reindex')
  reindexAll() { return this.ragService.reindexAll() }

  @Post('query')
  query(@Body() input: QueryRagDto) { return this.ragService.query(input) }

  private assertLoopback(request: any) {
    const remoteAddress = String(request.socket?.remoteAddress || request.connection?.remoteAddress || '')
    if (!isLoopbackAddress(remoteAddress)) throw new ForbiddenException('Knowledge-base credentials and settings can only be changed from the local Terra page')
  }
}
