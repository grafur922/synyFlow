import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { CreateRagDocumentDto } from './dto/create-rag-document.dto'
import { QueryRagDto } from './dto/query-rag.dto'
import { UpdateRagDocumentDto } from './dto/update-rag-document.dto'
import { RagService } from './rag.service'

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Get('status')
  getStatus() { return this.ragService.getStatus() }

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
}
