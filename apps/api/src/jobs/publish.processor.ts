import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import type { Account, Post } from "@intabot/shared";
import { ulid } from "ulid";
import { AccountRepository } from "../accounts/account.repository";
import { GraphError, describeGraphError } from "../instagram/graph-responses";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import { MediaAssetRepository } from "../media/media-asset.repository";
import { MEDIA_STORAGE, type MediaStoragePort } from "../media/media-storage.port";
import { IgMediaRefRepository } from "../moderation/ig-media-ref.repository";
import { PostRepository, PostTransitionConflictError } from "../posts/post.repository";
import { publishCaption } from "./publish-caption";
import { POLL_QUEUE } from "./queue.constants";

export interface PublishJobData {
  accountId: string;
  postId: string;
}

const MEDIA_URL_TTL_SECONDS = 3600;

@Injectable()
export class PublishProcessor {
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(MediaAssetRepository) private readonly assets: MediaAssetRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(INSTAGRAM_PORT) private readonly instagram: InstagramPort,
    @Inject(IgMediaRefRepository) private readonly igMediaRefs: IgMediaRefRepository,
    @Inject(POLL_QUEUE) private readonly pollQueue: Queue,
  ) {}

  async process(data: PublishJobData): Promise<{ containerId: string | null }> {
    const { accountId, postId } = data;

    const account = await this.accounts.get(accountId);
    if (!account) throw new Error(`account not found: ${accountId}`);

    const post = await this.posts.get(accountId, postId);
    if (!post) throw new Error(`post not found: ${postId}`);
    if (post.status !== "APPROVED") {
      this.logger.log(`post ${postId} is ${post.status}, not APPROVED - skipping`);
      return { containerId: null };
    }

    // Claim the post BEFORE any external side effect. A duplicated job, a
    // retry, or a racing worker fails this conditional write and no-ops, so at
    // most one Instagram container is ever created.
    let claimed;
    try {
      claimed = await this.posts.transition({
        accountId,
        postId,
        expectedStatus: "APPROVED",
        expectedVersion: post.version,
        nextStatus: "PUBLISHING",
      });
    } catch (err) {
      if (err instanceof PostTransitionConflictError) {
        this.logger.log(`post ${postId} already claimed - skipping`);
        return { containerId: null };
      }
      throw err;
    }

    if (account.dryRun) {
      const igMediaId = `dryrun-${ulid()}`;
      await this.posts.transition({
        accountId,
        postId,
        expectedStatus: "PUBLISHING",
        expectedVersion: claimed.version,
        nextStatus: "PUBLISHED",
        patch: { igMediaId, dryRun: true },
      });
      // Dry-run comments must still resolve to their post, so the inverse
      // item is written for the synthetic media id too.
      await this.igMediaRefs.put(igMediaId, { accountId, postId });
      this.logger.log(`dry run: post ${postId} was not sent to Instagram`);
      return { containerId: null };
    }

    try {
      if (post.format === "CAROUSEL") {
        return await this.startCarousel(account, post, claimed.version);
      }

      const assetId = post.mediaAssetIds[0];
      if (!assetId) throw new Error(`post ${postId} has no media asset`);
      const mediaUrl = await this.mediaUrl(accountId, assetId);
      const { containerId } = await this.instagram.createContainer(account, {
        format: post.format,
        mediaUrl,
        caption: publishCaption(post),
      });

      // PUBLISHING -> PUBLISHING is intentional: it stores containerId while
      // bumping the version, so a stale worker cannot later act on this post.
      await this.posts.transition({
        accountId,
        postId,
        expectedStatus: "PUBLISHING",
        expectedVersion: claimed.version,
        nextStatus: "PUBLISHING",
        patch: { containerId },
      });

      await this.pollQueue.add(
        "poll",
        { accountId, postId, attempt: 1 },
        { jobId: `poll:${postId}:${containerId}`, delay: 15_000 },
      );

      return { containerId };
    } catch (err) {
      // Instagram refused a call: record why and stop; any other error is not
      // ours to hide and goes back to the queue.
      if (!(err instanceof GraphError)) throw err;
      await this.posts.transition({
        accountId,
        postId,
        expectedStatus: "PUBLISHING",
        expectedVersion: claimed.version,
        nextStatus: "FAILED",
        patch: { failureReason: describeGraphError(err) },
      });
      this.logger.warn(`post ${postId} failed: ${describeGraphError(err)}`);
      return { containerId: null };
    }
  }

  /**
   * A carousel is built in stages: one child container per image now, then the
   * poll job creates the carousel container once every child has finished.
   */
  private async startCarousel(
    account: Account,
    post: Post,
    claimedVersion: number,
  ): Promise<{ containerId: string | null }> {
    const childContainerIds: string[] = [];
    for (const assetId of post.mediaAssetIds) {
      const { containerId } = await this.instagram.createContainer(account, {
        format: "IMAGE",
        mediaUrl: await this.mediaUrl(account.id, assetId),
        caption: "",
        isCarouselItem: true,
      });
      childContainerIds.push(containerId);
    }

    await this.posts.transition({
      accountId: account.id,
      postId: post.id,
      expectedStatus: "PUBLISHING",
      expectedVersion: claimedVersion,
      nextStatus: "PUBLISHING",
      patch: { childContainerIds },
    });

    await this.pollQueue.add(
      "poll",
      { accountId: account.id, postId: post.id, attempt: 1 },
      { jobId: `poll:${post.id}:children`, delay: 15_000 },
    );
    return { containerId: null };
  }

  private async mediaUrl(accountId: string, assetId: string): Promise<string> {
    const asset = await this.assets.get(accountId, assetId);
    if (!asset) throw new Error(`media asset not found: ${assetId}`);
    return this.storage.presignedUrl(asset.storageKey, MEDIA_URL_TTL_SECONDS);
  }
}
