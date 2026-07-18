import type { UpdateRssSubscriptionInput } from '../rss.model'
export class UpdateRssSubscriptionDto implements UpdateRssSubscriptionInput {
  url?: string
  title?: string
  tags?: string[]
  enabled?: boolean
}
