import { Global, Module } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { AccountsModule } from "../accounts/accounts.module";
import { AppConfigService } from "../config/config.service";
import { ContentModule } from "../content/content.module";
import { MediaModule } from "../media/media.module";
import { PostsModule } from "../posts/posts.module";
import { DraftProcessor } from "./draft.processor";
import {
  DRAFT_QUEUE,
  POLL_QUEUE,
  PUBLISH_QUEUE,
  PUBLISH_SCAN_QUEUE,
  QUEUE,
  REDIS_CONNECTION,
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
  imports: [AccountsModule, PostsModule, MediaModule, ContentModule],
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
    DraftProcessor,
    WorkersService,
  ],
  exports: [
    REDIS_CONNECTION,
    DRAFT_QUEUE,
    PUBLISH_SCAN_QUEUE,
    PUBLISH_QUEUE,
    POLL_QUEUE,
    DraftProcessor,
  ],
})
export class JobsModule {}
