import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { DraftProcessor, type DraftJobData } from "./draft.processor";
import { QUEUE, REDIS_CONNECTION, queuePrefix } from "./queue.constants";

@Injectable()
export class WorkersService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkersService.name);
  private workers: Worker[] = [];

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    @Inject(DraftProcessor) private readonly draft: DraftProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    // Tests drive processors directly; starting workers there would race with
    // the per-test table resets.
    if (process.env.NODE_ENV === "test") return;

    this.workers.push(
      new Worker<DraftJobData>(
        QUEUE.draft,
        async (job) => {
          await this.draft.process(job.data);
        },
        { connection: this.connection, prefix: queuePrefix() },
      ),
    );
    this.logger.log(`started ${this.workers.length} worker(s)`);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
