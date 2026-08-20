import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { DraftProcessor, type DraftJobData } from "./draft.processor";
import { ModerationProcessor, type ModerationJobData } from "./moderation.processor";
import { PollContainerProcessor, type PollJobData } from "./poll-container.processor";
import { PublishScanProcessor } from "./publish-scan.processor";
import { PublishProcessor, type PublishJobData } from "./publish.processor";
import { PUBLISH_SCAN_QUEUE, QUEUE, REDIS_CONNECTION, queuePrefix } from "./queue.constants";

const SCAN_INTERVAL_MS = 60_000;

@Injectable()
export class WorkersService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkersService.name);
  private workers: Worker[] = [];

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    @Inject(DraftProcessor) private readonly draft: DraftProcessor,
    @Inject(PublishProcessor) private readonly publish: PublishProcessor,
    @Inject(PollContainerProcessor) private readonly poll: PollContainerProcessor,
    @Inject(PublishScanProcessor) private readonly scan: PublishScanProcessor,
    @Inject(ModerationProcessor) private readonly moderation: ModerationProcessor,
    @Inject(PUBLISH_SCAN_QUEUE) private readonly scanQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Tests drive processors directly; starting workers there would race with
    // the per-test table resets.
    if (process.env.NODE_ENV === "test") return;

    const options = { connection: this.connection, prefix: queuePrefix() };

    this.workers.push(
      new Worker<DraftJobData>(QUEUE.draft, async (job) => {
        await this.draft.process(job.data);
      }, options),
      new Worker<PublishJobData>(QUEUE.publish, async (job) => {
        await this.publish.process(job.data);
      }, options),
      new Worker<PollJobData>(QUEUE.pollContainer, async (job) => {
        await this.poll.process(job.data);
      }, options),
      new Worker(QUEUE.publishScan, async () => {
        await this.scan.process();
      }, options),
      new Worker<ModerationJobData>(QUEUE.moderation, async (job) => {
        await this.moderation.process(job.data);
      }, options),
    );

    // One repeatable trigger drives the scan; BullMQ keeps a single schedule
    // per repeat key even across restarts.
    await this.scanQueue.add(
      "scan",
      {},
      { repeat: { every: SCAN_INTERVAL_MS }, jobId: "publish-scan" },
    );

    this.logger.log(`started ${this.workers.length} workers`);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
