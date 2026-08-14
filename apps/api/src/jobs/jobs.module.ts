import { Global, Module } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { AppConfigService } from "../config/config.service";
import {
  DRAFT_QUEUE,
  POLL_QUEUE,
  PUBLISH_QUEUE,
  PUBLISH_SCAN_QUEUE,
  QUEUE,
  REDIS_CONNECTION,
  queuePrefix,
} from "./queue.constants";

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
  ],
  exports: [REDIS_CONNECTION, DRAFT_QUEUE, PUBLISH_SCAN_QUEUE, PUBLISH_QUEUE, POLL_QUEUE],
})
export class JobsModule {}
