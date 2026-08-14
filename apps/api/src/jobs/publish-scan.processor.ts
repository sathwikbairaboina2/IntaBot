import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { AccountRepository } from "../accounts/account.repository";
import { PostRepository } from "../posts/post.repository";
import { PUBLISH_QUEUE } from "./queue.constants";

@Injectable()
export class PublishScanProcessor {
  private readonly logger = new Logger(PublishScanProcessor.name);

  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(PUBLISH_QUEUE) private readonly publishQueue: Queue,
  ) {}

  async process(): Promise<{ enqueued: number }> {
    const now = new Date().toISOString();
    let enqueued = 0;

    for (const account of await this.accounts.list()) {
      if (account.status !== "ACTIVE") continue;

      for (const post of await this.posts.listDue(account.id, now)) {
        await this.publishQueue.add(
          "publish",
          { accountId: account.id, postId: post.id },
          // The version in the jobId means a re-approved post can be published
          // again, while a duplicated scan cannot double-enqueue.
          { jobId: `publish:${post.id}:${post.version}`, attempts: 3 },
        );
        enqueued += 1;
      }
    }

    if (enqueued > 0) this.logger.log(`enqueued ${enqueued} post(s) for publishing`);
    return { enqueued };
  }
}
