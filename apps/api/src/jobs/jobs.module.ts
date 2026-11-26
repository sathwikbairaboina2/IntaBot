import { Global, Module } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { AccountsModule } from "../accounts/accounts.module";
import { AppConfigService } from "../config/config.service";
import { ContentModule } from "../content/content.module";
import { MediaModule } from "../media/media.module";
import { ModerationModule } from "../moderation/moderation.module";
import { PostsModule } from "../posts/posts.module";
import { InstagramModule } from "../instagram/instagram.module";
import { DraftProcessor } from "./draft.processor";
import { ModerationProcessor } from "./moderation.processor";
import { PollContainerProcessor } from "./poll-container.processor";
import { PublishScanProcessor } from "./publish-scan.processor";
import { PublishProcessor } from "./publish.processor";
import { TokenRefreshProcessor } from "./token-refresh.processor";
import {
  DRAFT_QUEUE,
  MODERATION_QUEUE,
  POLL_QUEUE,
  PUBLISH_QUEUE,
  PUBLISH_SCAN_QUEUE,
  QUEUE,
  REDIS_CONNECTION,
  TOKEN_REFRESH_QUEUE,
  queuePrefix,
} from "./queue.constants";
import { WorkersService } from "./workers.service";

function queueProvider(token: symbol, name: string) {
  return {
    provide: token,
    inject: [REDIS_CONNECTION],
    useFactory: (connection: IORedis) =>
      new Queue(name, { connection, prefix: queuePrefix() }),
  };
}

@Global()
@Module({
  imports: [
    AccountsModule,
    PostsModule,
    MediaModule,
    ContentModule,
    InstagramModule,
    ModerationModule,
  ],
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [AppConfigService],
      // maxRetriesPerRequest must be null or BullMQ workers refuse to start.
      useFactory: (config: AppConfigService) =>
        new IORedis(config.redisUrl, { maxRetriesPerRequest: null }),
    },
    queueProvider(DRAFT_QUEUE, QUEUE.draft),
    queueProvider(PUBLISH_SCAN_QUEUE, QUEUE.publishScan),
    queueProvider(PUBLISH_QUEUE, QUEUE.publish),
    queueProvider(POLL_QUEUE, QUEUE.pollContainer),
    queueProvider(MODERATION_QUEUE, QUEUE.moderation),
    queueProvider(TOKEN_REFRESH_QUEUE, QUEUE.tokenRefresh),
    DraftProcessor,
    PublishScanProcessor,
    PublishProcessor,
    PollContainerProcessor,
    ModerationProcessor,
    TokenRefreshProcessor,
    WorkersService,
  ],
  exports: [
    REDIS_CONNECTION,
    DRAFT_QUEUE,
    PUBLISH_SCAN_QUEUE,
    PUBLISH_QUEUE,
    POLL_QUEUE,
    MODERATION_QUEUE,
    TOKEN_REFRESH_QUEUE,
    DraftProcessor,
    PublishScanProcessor,
    PublishProcessor,
    PollContainerProcessor,
    ModerationProcessor,
    TokenRefreshProcessor,
  ],
})
export class JobsModule {}
