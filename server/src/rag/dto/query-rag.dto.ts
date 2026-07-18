import type { RagQueryInput } from '../rag.model'

export class QueryRagDto implements RagQueryInput {
  query!: string
  maxPrivacy?: RagQueryInput['maxPrivacy']
  documentIds?: string[]
  limit?: number
  includeFlagged?: boolean
  provider?: RagQueryInput['provider']
  externalConsent?: boolean
}
