import type { CreateRssSubscriptionInput } from '../rss.model'
export class CreateRssSubscriptionDto implements CreateRssSubscriptionInput {
  url!: string
  title?: string
  tags?: string[]
  enabled?: boolean
  fetchNow?: boolean
}
