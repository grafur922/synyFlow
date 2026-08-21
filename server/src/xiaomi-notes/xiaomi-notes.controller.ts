import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { SaveXiaomiNoteDto } from './dto/save-xiaomi-note.dto'
import { SaveXiaomiCredentialsDto } from './dto/save-xiaomi-credentials.dto'
import { UpdateXiaomiNoteMetadataDto } from './dto/update-xiaomi-note-metadata.dto'
import { UpdateXiaomiRefreshCredentialsDto } from './dto/update-xiaomi-refresh-credentials.dto'
import { XiaomiNotesService } from './xiaomi-notes.service'
import { XiaomiNoteMetadataService } from './xiaomi-note-metadata.service'
import { isLoopbackAddress } from '../security/api-access'
import { XiaomiNotesRagSyncService } from '../rag/xiaomi-notes-rag-sync.service'

@Controller('xiaomi-notes')
export class XiaomiNotesController {
  constructor(
    private readonly notesService: XiaomiNotesService,
    private readonly metadataService: XiaomiNoteMetadataService,
    private readonly ragSync: XiaomiNotesRagSyncService
  ) {}

  @Get('status')
  getStatus() {
    return this.notesService.getStatus()
  }

  @Post('credentials')
  saveCredentials(@Body() input: SaveXiaomiCredentialsDto, @Req() request: any) {
    this.assertLoopback(request)
    return this.notesService.saveCredentials(input)
  }

  @Patch('refresh-credentials')
  updateRefreshCredentials(@Body() input: UpdateXiaomiRefreshCredentialsDto, @Req() request: any) {
    this.assertLoopback(request)
    return this.notesService.updateRefreshCredentials(input)
  }

  @Post('refresh-now')
  refreshNow(@Req() request: any) {
    this.assertLoopback(request)
    return this.notesService.refreshNow()
  }

  @Get('audit')
  getAuditEvents() {
    return this.notesService.getAuditEvents()
  }

  @Get()
  findPage(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('refresh') refresh?: string
  ) {
    return this.notesService.findPage({
      cursor,
      limit: limit ? Number(limit) : undefined,
      forceRefresh: refresh === 'true'
    })
  }

  @Get('metadata/status')
  getMetadataStatus() {
    return this.metadataService.getStatus()
  }

  @Get('metadata')
  findAllMetadata() {
    return this.metadataService.findAll()
  }

  @Get('metadata/:id')
  findMetadata(@Param('id') id: string) {
    return this.metadataService.findOne(id)
  }

  @Patch('metadata/:id')
  updateMetadata(@Param('id') id: string, @Body() input: UpdateXiaomiNoteMetadataDto) {
    return this.metadataService.update(id, input)
  }

  @Delete('metadata/:id')
  removeMetadata(@Param('id') id: string) {
    return this.metadataService.remove(id)
  }

  @Get('history/archive')
  findHistoryArchive() {
    return this.notesService.findHistoryArchive()
  }

  @Post('history/archive/:historyId/recreate')
  recreateFromHistory(@Param('historyId') historyId: string) {
    return this.notesService.recreateFromHistory(historyId)
  }

  @Get(':id/history')
  findHistory(@Param('id') id: string) {
    return this.notesService.findHistory(id)
  }

  @Get(':id/history/:historyId')
  findHistoryVersion(@Param('id') id: string, @Param('historyId') historyId: string) {
    return this.notesService.findHistoryVersion(id, historyId)
  }

  @Post(':id/history')
  createHistoryCheckpoint(@Param('id') id: string) {
    return this.notesService.createHistoryCheckpoint(id)
  }

  @Post(':id/history/:historyId/restore')
  async restoreHistory(@Param('id') id: string, @Param('historyId') historyId: string) {
    const restored = await this.notesService.restoreHistory(id, historyId)
    this.ragSync.enqueueItem(restored.id, 'upsert')
    return restored
  }

  @Delete(':id/history/:historyId')
  removeHistoryVersion(@Param('id') id: string, @Param('historyId') historyId: string) {
    return this.notesService.removeHistoryVersion(id, historyId)
  }

  @Delete(':id/history')
  clearHistory(@Param('id') id: string) {
    return this.notesService.clearHistory(id)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notesService.findOne(id)
  }

  @Post()
  async create(@Body() note: SaveXiaomiNoteDto) {
    const created = await this.notesService.create(note)
    this.ragSync.enqueueItem(created.id, 'upsert')
    return created
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() note: SaveXiaomiNoteDto) {
    const updated = await this.notesService.update(id, note)
    this.ragSync.enqueueItem(updated.id, 'upsert')
    return updated
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const removed = await this.notesService.remove(id)
    this.ragSync.enqueueItem(id, 'delete')
    return removed
  }

  private assertLoopback(request: any) {
    const remoteAddress = String(request.socket?.remoteAddress || request.connection?.remoteAddress || '')
    if (!isLoopbackAddress(remoteAddress)) throw new ForbiddenException('小米云凭证只能通过本机 Terra 页面保存')
  }

}
