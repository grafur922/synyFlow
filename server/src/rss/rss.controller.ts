import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CreateRssSubscriptionDto } from './dto/create-rss-subscription.dto'
import { UpdateRssItemDto } from './dto/update-rss-item.dto'
import { UpdateRssSubscriptionDto } from './dto/update-rss-subscription.dto'
import { RssService } from './rss.service'

@Controller('rss')
export class RssController {
  constructor(private readonly rssService: RssService) {}

  @Get('status')
  getStatus() {
    return this.rssService.getStatus()
  }

  @Post('fetch-all')
  fetchAll(@Query('force') force?: string) {
    return this.rssService.fetchDueSubscriptions(force === 'true')
  }

  @Get('subscriptions')
  findSubscriptions() {
    return this.rssService.findSubscriptions()
  }

  @Post('subscriptions')
  createSubscription(@Body() input: CreateRssSubscriptionDto) {
    return this.rssService.createSubscription(input)
  }

  @Get('subscriptions/:id')
  findSubscription(@Param('id') id: string) {
    return this.rssService.findSubscription(id)
  }

  @Patch('subscriptions/:id')
  updateSubscription(@Param('id') id: string, @Body() input: UpdateRssSubscriptionDto) {
    return this.rssService.updateSubscription(id, input)
  }

  @Delete('subscriptions/:id')
  removeSubscription(@Param('id') id: string) {
    return this.rssService.removeSubscription(id)
  }

  @Post('subscriptions/:id/fetch')
  fetchSubscription(@Param('id') id: string) {
    return this.rssService.fetchSubscription(id)
  }

  @Get('items')
  findItems(
    @Query('subscriptionId') subscriptionId?: string,
    @Query('read') read?: string,
    @Query('favorite') favorite?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string
  ) {
    return this.rssService.findItems({
      subscriptionId,
      read,
      favorite,
      offset: offset ? Number(offset) : undefined,
      limit: limit ? Number(limit) : undefined
    })
  }

  @Get('items/:id')
  findItem(@Param('id') id: string) {
    return this.rssService.findItem(id)
  }

  @Patch('items/:id')
  updateItem(@Param('id') id: string, @Body() input: UpdateRssItemDto) {
    return this.rssService.updateItem(id, input)
  }
}
