import type { UpdateTravelCandidateInput } from '../travel.model'

export class UpdateTravelCandidateDto implements UpdateTravelCandidateInput {
  title?: string
  summary?: string
  tags?: string[]
  status?: 'inbox' | 'saved' | 'added' | 'dismissed'
  placeName?: string
  address?: string
  location?: { latitude: number; longitude: number } | null
  notes?: string
}
