import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { BlogService } from './blog.service'
import { CreateBlogDraftDto } from './dto/create-blog-draft.dto'
import { UpdateBlogDraftDto } from './dto/update-blog-draft.dto'

@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get('status')
  getStatus() { return this.blogService.getStatus() }

  @Get('drafts')
  findAll() { return this.blogService.findAll() }

  @Post('drafts')
  create(@Body() input: CreateBlogDraftDto) { return this.blogService.create(input) }

  @Post('drafts/from-xiaomi/:noteId')
  createFromXiaomi(@Param('noteId') noteId: string) { return this.blogService.createFromXiaomiNote(noteId) }

  @Get('drafts/:id')
  findOne(@Param('id') id: string) { return this.blogService.findOne(id) }

  @Patch('drafts/:id')
  update(@Param('id') id: string, @Body() input: UpdateBlogDraftDto) { return this.blogService.update(id, input) }

  @Delete('drafts/:id')
  remove(@Param('id') id: string) { return this.blogService.remove(id) }

  @Get('drafts/:id/scan')
  scan(@Param('id') id: string) { return this.blogService.scan(id) }

  @Get('drafts/:id/preview')
  preview(@Param('id') id: string) { return this.blogService.preview(id) }

  @Post('drafts/:id/publish')
  publish(@Param('id') id: string, @Body() body: { acceptedFindingIds?: string[] }) {
    return this.blogService.publish(id, body?.acceptedFindingIds || [])
  }

  @Post('drafts/:id/withdraw')
  withdraw(@Param('id') id: string) { return this.blogService.withdraw(id) }
}
