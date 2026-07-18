import type { CreateRagDocumentInput, RagDocumentSource, RagMimeType, RagPrivacy } from '../rag.model'

export class CreateRagDocumentDto implements CreateRagDocumentInput {
  title!: string
  content!: string
  tags?: string[]
  privacy?: RagPrivacy
  mimeType?: RagMimeType
  source?: RagDocumentSource
  originalFilename?: string
}
