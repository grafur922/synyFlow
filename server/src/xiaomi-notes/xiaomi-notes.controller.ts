import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { SaveXiaomiNoteDto } from './dto/save-xiaomi-note.dto'
import { UpdateXiaomiNoteMetadataDto } from './dto/update-xiaomi-note-metadata.dto'
import { XiaomiNotesService } from './xiaomi-notes.service'
import { XiaomiNoteMetadataService } from './xiaomi-note-metadata.service'

@Controller('xiaomi-notes')
export class XiaomiNotesController {
  constructor(
    private readonly notesService: XiaomiNotesService,
    private readonly metadataService: XiaomiNoteMetadataService
  ) {}

  @Get('status')
  getStatus() {
    return this.notesService.getStatus()
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
  restoreHistory(@Param('id') id: string, @Param('historyId') historyId: string) {
    return this.notesService.restoreHistory(id, historyId)
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
  create(@Body() note: SaveXiaomiNoteDto) {
    return this.notesService.create(note)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() note: SaveXiaomiNoteDto) {
    return this.notesService.update(id, note)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notesService.remove(id)
  }
}
