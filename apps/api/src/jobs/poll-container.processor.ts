import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { AccountRepository } from "../accounts/account.repository";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import { PostRepository } from "../posts/post.repository";
import { POLL_QUEUE } from "./queue.constants";

export const MAX_POLL_ATTEMPTS = 20;
export const POLL_DELAY_MS = 15_000;

export type PollOutcome = "published" | "failed" | "pending";

export interface PollJobData {
  accountId: string;
  postId: string;
  attempt: number;
}

@Injectable()
export class PollContainerProcessor {
  private readonly logger = new Logger(PollContainerProcessor.name);

  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(INSTAGRAM_PORT) private readonly instagram: InstagramPort,
    @Inject(POLL_QUEUE) private readonly pollQueue: Queue,
  ) {}

  async process(data: PollJobData): Promise<PollOutcome> {
    const { accountId, postId, attempt } = data;

    const account = await this.accounts.get(accountId);
    if (!account) throw new Error(`account not found: ${accountId}`);

    const post = await this.posts.get(accountId, postId);
    if (!post) throw new Error(`post not found: ${postId}`);

    // Another poll already finished this post.
    if (post.status !== "PUBLISHING") return post.status === "PUBLISHED" ? "published" : "failed";
    if (!post.containerId) throw new Error(`post ${postId} has no container`);

    const status = await this.instagram.getContainerStatus(account, post.containerId);

    if (status === "ERROR") {
      await this.posts.transition({
        accountId,
        postId,
        expectedStatus: "PUBLISHING",
        expectedVersion: post.version,
        nextStatus: "FAILED",
        patch: { failureReason: "instagram rejected the media container" },
      });
      return "failed";
    }

    if (status === "IN_PROGRESS") {
      if (attempt >= MAX_POLL_ATTEMPTS) {
        await this.posts.transition({
          accountId,
          postId,
          expectedStatus: "PUBLISHING",
          expectedVersion: post.version,
          nextStatus: "FAILED",
          patch: { failureReason: "container timeout" },
        });
        return "failed";
      }

      await this.pollQueue.add(
        "poll",
        { accountId, postId, attempt: attempt + 1 },
        { jobId: `poll:${postId}:${post.containerId}:${attempt + 1}`, delay: POLL_DELAY_MS },
      );
      return "pending";
    }

    const result = await this.instagram.publishContainer(account, post.containerId);
    await this.posts.transition({
      accountId,
      postId,
      expectedStatus: "PUBLISHING",
      expectedVersion: post.version,
      nextStatus: "PUBLISHED",
      patch: { igMediaId: result.igMediaId, permalink: result.permalink },
    });
    this.logger.log(`published post ${postId} as ${result.igMediaId}`);
    return "published";
  }
}
