import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { ulid } from "ulid";
import { AccountRepository } from "../accounts/account.repository";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import { MediaAssetRepository } from "../media/media-asset.repository";
import { MEDIA_STORAGE, type MediaStoragePort } from "../media/media-storage.port";
import { PostRepository, PostTransitionConflictError } from "../posts/post.repository";
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
      await this.posts.transition({
        accountId,
        postId,
        expectedStatus: "PUBLISHING",
        expectedVersion: claimed.version,
        nextStatus: "PUBLISHED",
        patch: { igMediaId: `dryrun-${ulid()}`, dryRun: true },
      });
      this.logger.log(`dry run: post ${postId} was not sent to Instagram`);
      return { containerId: null };
    }

    const assetId = post.mediaAssetIds[0];
    if (!assetId) throw new Error(`post ${postId} has no media asset`);
    const asset = await this.assets.get(accountId, assetId);
    if (!asset) throw new Error(`media asset not found: ${assetId}`);

    const mediaUrl = await this.storage.presignedUrl(asset.storageKey, MEDIA_URL_TTL_SECONDS);
    const { containerId } = await this.instagram.createContainer(account, {
      format: post.format,
      mediaUrl,
      caption: [post.caption, post.hashtags.join(" ")].filter(Boolean).join("\n\n"),
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
  }
}
