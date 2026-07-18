import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { ResourcesService } from './resources.service'
import { Body } from '@nestjs/common'

@Controller('resources')
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get('status')
  getStatus() {
    return this.resourcesService.getStatus()
  }

  @Get('conflicts')
  findConflicts(@Query('status') status?: string) {
    return this.resourcesService.findConflicts(status)
  }

  @Get('conflicts/:id')
  findConflict(@Param('id') id: string) {
    return this.resourcesService.findConflict(id)
  }

  @Post('conflicts/:id/resolve')
  resolveConflict(@Param('id') id: string, @Body() body: { resolution?: string }) {
    return this.resourcesService.resolveConflict(id, body?.resolution || '')
  }

  @Get('search')
  search(
    @Query('q') query: string,
    @Query('type') type?: string,
    @Query('source') source?: string,
    @Query('privacy') privacy?: string,
    @Query('maxPrivacy') maxPrivacy?: string,
    @Query('tag') tag?: string,
    @Query('project') project?: string,
    @Query('location') location?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string
  ) {
    return this.resourcesService.search(query, {
      type,
      source,
      privacy,
      maxPrivacy,
      tag,
      project,
      location,
      fromDate,
      toDate,
      limit: limit ? Number(limit) : undefined
    })
  }

  @Post('sync/tasks')
  syncTasks() {
    return this.resourcesService.syncTasks()
  }

  @Post('sync/xiaomi-notes')
  syncXiaomiNotes(@Query('mode') mode?: string) {
    return this.resourcesService.syncXiaomiNotes(mode)
  }

  @Post('sync/all')
  syncAll() {
    return this.resourcesService.syncAll()
  }

  @Get()
  findAll(
    @Query('type') type?: string,
    @Query('source') source?: string,
    @Query('privacy') privacy?: string,
    @Query('archived') archived?: string,
    @Query('tag') tag?: string,
    @Query('project') project?: string,
    @Query('location') location?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string
  ) {
    return this.resourcesService.findAll({
      type,
      source,
      privacy,
      archived,
      tag,
      project,
      location,
      fromDate,
      toDate,
      offset: offset ? Number(offset) : undefined,
      limit: limit ? Number(limit) : undefined
    })
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.resourcesService.findOne(id)
  }

  @Delete(':id')
  removeFromIndex(@Param('id') id: string) {
    return this.resourcesService.removeFromIndex(id)
  }
}
