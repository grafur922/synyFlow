import type { BlogPrivacy, CreateBlogDraftInput } from '../blog.model'
export class CreateBlogDraftDto implements CreateBlogDraftInput {
  title!: string
  slug?: string
  content?: string
  excerpt?: string
  tags?: string[]
  privacy?: BlogPrivacy
  sourceNoteId?: string
}
