import type { BlogPrivacy, UpdateBlogDraftInput } from '../blog.model'
export class UpdateBlogDraftDto implements UpdateBlogDraftInput {
  title?: string
  slug?: string
  content?: string
  excerpt?: string
  tags?: string[]
  privacy?: BlogPrivacy
}
