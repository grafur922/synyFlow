import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common'
import { CreateTripDto } from './dto/create-trip.dto'
import { UpdateTripDto } from './dto/update-trip.dto'
import { AddCandidateToTripDto } from './dto/add-candidate-to-trip.dto'
import { UpdateTravelCandidateDto } from './dto/update-travel-candidate.dto'
import { TravelService } from './travel.service'
import { TravelMapService } from './travel-map.service'
import { CreateTravelMapLinkDto } from './dto/create-travel-map-link.dto'
import { ExportOfflinePackageDto } from './dto/offline-package.dto'

@Controller('travel')
export class TravelController {
  constructor(
    private readonly travelService: TravelService,
    private readonly travelMapService: TravelMapService
  ) {}

  @Get('status')
  getStatus() { return this.travelService.getStatus() }

  @Get('map/providers')
  getMapProviders() { return this.travelMapService.getProviders() }

  @Post('map/link')
  createMapLink(@Body() input: CreateTravelMapLinkDto) { return this.travelMapService.createLink(input) }

  @Post('offline-packages/import')
  importOfflinePackage(
    @Body() content: Buffer,
    @Headers('x-terra-package-passphrase') encodedPassphrase?: string
  ) {
    return this.travelService.importOfflinePackage(content, decodeHeader(encodedPassphrase, 'Offline package passphrase'))
  }

  @Get('candidates')
  findCandidates(@Query('status') status?: string, @Query('source') source?: string) {
    return this.travelService.findCandidates({ status, source })
  }

  @Post('candidates/import-favorites')
  importFavoriteCandidates(@Query('maxPrivacy') maxPrivacy?: string) {
    return this.travelService.importFavoriteCandidates(maxPrivacy || 'private')
  }

  @Patch('candidates/:id')
  updateCandidate(@Param('id') id: string, @Body() input: UpdateTravelCandidateDto) {
    return this.travelService.updateCandidate(id, input)
  }

  @Delete('candidates/:id')
  removeCandidate(@Param('id') id: string) {
    return this.travelService.removeCandidate(id)
  }

  @Post('candidates/:id/add-to-trip')
  addCandidateToTrip(@Param('id') id: string, @Body() input: AddCandidateToTripDto) {
    return this.travelService.addCandidateToTrip(id, input.tripId, input.dayId)
  }

  @Get('trips')
  findAll() { return this.travelService.findAll() }

  @Post('trips')
  create(@Body() input: CreateTripDto) { return this.travelService.create(input) }

  @Get('trips/:id')
  findOne(@Param('id') id: string) { return this.travelService.findOne(id) }

  @Patch('trips/:id')
  update(@Param('id') id: string, @Body() input: UpdateTripDto) { return this.travelService.update(id, input) }

  @Delete('trips/:id')
  remove(@Param('id') id: string) { return this.travelService.remove(id) }

  @Post('trips/:id/duplicate')
  duplicate(@Param('id') id: string) { return this.travelService.duplicate(id) }

  @Post('trips/:id/attachments')
  uploadAttachment(
    @Param('id') id: string,
    @Body() content: Buffer,
    @Headers('x-terra-attachment-name') encodedName?: string,
    @Headers('x-terra-attachment-mime') encodedMime?: string,
    @Headers('x-terra-attachment-scope') scope?: string,
    @Headers('x-terra-attachment-scope-id') scopeId?: string
  ) {
    return this.travelService.addAttachment(id, {
      filename: decodeHeader(encodedName, 'Attachment name'),
      mimeType: decodeHeader(encodedMime, 'Attachment MIME type'),
      scope: scope as 'trip' | 'day' | 'place' | 'booking',
      scopeId,
      content
    })
  }

  @Get('trips/:id/attachments/:attachmentId')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) response: any
  ) {
    const result = await this.travelService.getAttachment(id, attachmentId)
    response.setHeader('Content-Type', 'application/octet-stream')
    response.setHeader('Content-Length', String(result.content.length))
    response.setHeader('Content-Disposition', contentDisposition(result.attachment.filename))
    return new StreamableFile(result.content)
  }

  @Delete('trips/:id/attachments/:attachmentId')
  removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return this.travelService.removeAttachment(id, attachmentId)
  }

  @Post('trips/:id/offline-package')
  async exportOfflinePackage(
    @Param('id') id: string,
    @Body() input: ExportOfflinePackageDto,
    @Res({ passthrough: true }) response: any
  ) {
    const result = await this.travelService.exportOfflinePackage(id, input?.passphrase)
    response.setHeader('Content-Type', 'application/vnd.terra.trip+json')
    response.setHeader('Content-Length', String(result.content.length))
    response.setHeader('Content-Disposition', contentDisposition(result.filename))
    return new StreamableFile(result.content)
  }

  @Get('trips/:id/summary')
  summary(@Param('id') id: string) { return this.travelService.getSummary(id) }

  @Get('trips/:id/export')
  exportTrip(@Param('id') id: string, @Query('format') format?: string) {
    if (format !== undefined && format !== 'json' && format !== 'markdown') {
      throw new BadRequestException('Unsupported export format')
    }
    return this.travelService.exportTrip(id, format || 'markdown')
  }
}

function decodeHeader(value: string | undefined, label: string) {
  if (typeof value !== 'string' || !value || value.length > 4_096) throw new BadRequestException(`${label} header is missing or invalid`)
  try {
    return decodeURIComponent(value)
  } catch {
    throw new BadRequestException(`${label} header is invalid`)
  }
}

function contentDisposition(filename: string) {
  const fallback = filename.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'terra-file'
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
