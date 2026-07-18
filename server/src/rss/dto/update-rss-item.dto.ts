import type { UpdateRssItemInput } from '../rss.model'
export class UpdateRssItemDto implements UpdateRssItemInput {
  read?: boolean
  favorite?: boolean
  tags?: string[]
}
