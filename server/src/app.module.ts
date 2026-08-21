import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common'
import { HealthController } from './health.controller'
import { TasksController } from './tasks/tasks.controller'
import { TasksService } from './tasks/tasks.service'
import { Logger } from '@nestjs/common'
import { XiaomiNotesController } from './xiaomi-notes/xiaomi-notes.controller'
import { XiaomiNotesService } from './xiaomi-notes/xiaomi-notes.service'
import { XiaomiNoteHistoryService } from './xiaomi-notes/xiaomi-note-history.service'
import { XiaomiNoteMetadataService } from './xiaomi-notes/xiaomi-note-metadata.service'
import { XiaomiPassportService } from './xiaomi-notes/xiaomi-passport.service'
import { ResourcesController } from './resources/resources.controller'
import { ResourcesService } from './resources/resources.service'
import { RssController } from './rss/rss.controller'
import { RssService } from './rss/rss.service'
import { BlogController } from './blog/blog.controller'
import { BlogService } from './blog/blog.service'
import { TravelController } from './travel/travel.controller'
import { TravelService } from './travel/travel.service'
import { TravelAttachmentStore } from './travel/travel-attachment.store'
import { TravelMapService } from './travel/travel-map.service'
import { RagController } from './rag/rag.controller'
import { RagService } from './rag/rag.service'
import { AliyunEmbeddingProvider } from './rag/aliyun-embedding.provider'
import { LanceDbVectorStore } from './rag/lancedb-vector.store'
import { XiaomiNotesRagSyncService } from './rag/xiaomi-notes-rag-sync.service'
import { ExternalRagProvider } from './rag/external-rag.provider'
import { ApiAccessMiddleware } from './security/api-access'

@Module({
  controllers: [HealthController, TasksController, XiaomiNotesController, ResourcesController, RssController, BlogController, TravelController, RagController],
  providers: [TasksService, XiaomiNotesService, XiaomiNoteHistoryService, XiaomiNoteMetadataService, XiaomiPassportService, ResourcesService, RssService, BlogService, TravelAttachmentStore, TravelMapService, TravelService, ExternalRagProvider, AliyunEmbeddingProvider, LanceDbVectorStore, RagService, XiaomiNotesRagSyncService]
})
export class AppModule implements NestModule {
  private readonly logger = new Logger('HTTP')

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ApiAccessMiddleware).forRoutes('*')
    consumer
      .apply((req: any, res: any, next: any) => {
        const { method, originalUrl } = req
        const startedAt = Date.now()
        res.on('finish', () => {
          const { statusCode } = res
          this.logger.log(`${method} ${redactRequestTarget(originalUrl)} ${statusCode} ${Date.now() - startedAt}ms`)
        })
        next()
      })
      .forRoutes('*')
  }
}

function redactRequestTarget(value: unknown) {
  const path = typeof value === 'string' ? value.split('?')[0] : ''
  const segments = path.split('/').filter(Boolean)
  if (!segments.length) return '/'
  return `/${segments.slice(0, 2).map((segment) => segment.replace(/[^a-z0-9_-]/gi, '') || 'unknown').join('/')}`
}
