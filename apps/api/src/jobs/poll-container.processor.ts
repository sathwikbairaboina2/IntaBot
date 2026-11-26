import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import type { Account, Post } from "@intabot/shared";
import { AccountRepository } from "../accounts/account.repository";
import { GraphError, describeGraphError } from "../instagram/graph-responses";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import { IgMediaRefRepository } from "../moderation/ig-media-ref.repository";
import { PostRepository } from "../posts/post.repository";
import { publishCaption } from "./publish-caption";
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
    @Inject(IgMediaRefRepository) private readonly igMediaRefs: IgMediaRefRepository,
    @Inject(POLL_QUEUE) private readonly pollQueue: Queue,
  ) {}

  async process(data: PollJobData): Promise<PollOutcome> {
    try {
      return await this.run(data);
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      // Instagram refused a call: record why on the post. It can be retried
      // from the panel; nothing here retries a publish blindly.
      const post = await this.posts.get(data.accountId, data.postId);
      if (post?.status !== "PUBLISHING") throw err;
      this.logger.warn(`post ${data.postId} failed: ${describeGraphError(err)}`);
      return this.fail(post, describeGraphError(err));
    }
  }

  private async run(data: PollJobData): Promise<PollOutcome> {
    const { accountId, postId, attempt } = data;

    const account = await this.accounts.get(accountId);
    if (!account) throw new Error(`account not found: ${accountId}`);

    const post = await this.posts.get(accountId, postId);
    if (!post) throw new Error(`post not found: ${postId}`);

    // Another poll already finished this post.
    if (post.status !== "PUBLISHING") return post.status === "PUBLISHED" ? "published" : "failed";
    if (!post.containerId) {
      // A carousel without its own container is still waiting on its slides.
      if (post.format === "CAROUSEL" && post.childContainerIds?.length) {
        return this.pollChildren(account, post, attempt);
      }
      throw new Error(`post ${postId} has no container`);
    }

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

    return this.publish(account, post, post.containerId);
  }

  /**
   * Every slide must be FINISHED before the carousel container can be created;
   * one ERROR fails the whole post, naming the slide.
   */
  private async pollChildren(account: Account, post: Post, attempt: number): Promise<PollOutcome> {
    const children = post.childContainerIds ?? [];
    const statuses = await Promise.all(
      children.map((id) => this.instagram.getContainerStatus(account, id)),
    );

    const rejected = statuses.indexOf("ERROR");
    if (rejected !== -1) {
      return this.fail(post, `instagram rejected carousel slide ${rejected + 1}`);
    }

    if (statuses.includes("IN_PROGRESS")) {
      if (attempt >= MAX_POLL_ATTEMPTS) return this.fail(post, "container timeout");
      await this.pollQueue.add(
        "poll",
        { accountId: post.accountId, postId: post.id, attempt: attempt + 1 },
        { jobId: `poll:${post.id}:children:${attempt + 1}`, delay: POLL_DELAY_MS },
      );
      return "pending";
    }

    const { containerId } = await this.instagram.createContainer(account, {
      format: "CAROUSEL",
      mediaUrl: "",
      caption: publishCaption(post),
      childContainerIds: children,
    });
    await this.posts.transition({
      accountId: post.accountId,
      postId: post.id,
      expectedStatus: "PUBLISHING",
      expectedVersion: post.version,
      nextStatus: "PUBLISHING",
      patch: { containerId },
    });
    // The carousel container gets its own fresh polling budget.
    await this.pollQueue.add(
      "poll",
      { accountId: post.accountId, postId: post.id, attempt: 1 },
      { jobId: `poll:${post.id}:${containerId}`, delay: POLL_DELAY_MS },
    );
    return "pending";
  }

  private async fail(post: Post, failureReason: string): Promise<PollOutcome> {
    await this.posts.transition({
      accountId: post.accountId,
      postId: post.id,
      expectedStatus: "PUBLISHING",
      expectedVersion: post.version,
      nextStatus: "FAILED",
      patch: { failureReason },
    });
    return "failed";
  }

  private async publish(account: Account, post: Post, containerId: string): Promise<PollOutcome> {
    const { accountId, id: postId } = post;
    const result = await this.instagram.publishContainer(account, containerId);
    await this.posts.transition({
      accountId,
      postId,
      expectedStatus: "PUBLISHING",
      expectedVersion: post.version,
      nextStatus: "PUBLISHED",
      patch: { igMediaId: result.igMediaId, permalink: result.permalink },
    });
    await this.igMediaRefs.put(result.igMediaId, { accountId, postId });
    this.logger.log(`published post ${postId} as ${result.igMediaId}`);
    return "published";
  }
}
