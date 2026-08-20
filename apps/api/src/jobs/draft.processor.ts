import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PostFormat } from "@intabot/shared";
import { AccountRepository } from "../accounts/account.repository";
import { COPY_WRITER, type CopyWriterPort } from "../content/copy-writer.port";
import { runDrafting } from "../content/drafting";
import { MediaAssetRepository } from "../media/media-asset.repository";
import { PostRepository } from "../posts/post.repository";

export interface DraftJobData {
  accountId: string;
  assetId: string;
  format: PostFormat;
}

@Injectable()
export class DraftProcessor {
  private readonly logger = new Logger(DraftProcessor.name);

  constructor(
    @Inject(COPY_WRITER) private readonly copyWriter: CopyWriterPort,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(MediaAssetRepository) private readonly assets: MediaAssetRepository,
  ) {}

  async process(data: DraftJobData): Promise<{ postId: string }> {
    const { accountId, assetId, format } = data;

    try {
      const result = await runDrafting(
        {
          copyWriter: this.copyWriter,
          loadAccount: async (id) => {
            const account = await this.accounts.get(id);
            if (!account) throw new Error(`account not found: ${id}`);
            return {
              voice: account.voice ?? "clear, friendly, specific",
              timezone: account.timezone,
              postingWindows: account.postingWindows,
            };
          },
          loadRecentCaptions: async (id) =>
            (await this.posts.listByStatus(id, "PUBLISHED")).slice(-10).map((p) => p.caption),
          loadTakenSlots: async (id, fromIso) => this.posts.listScheduledAfter(id, fromIso),
          now: () => new Date(),
        },
        { accountId, assetId, format },
      );

      const draft = await this.posts.create({
        accountId,
        format,
        mediaAssetIds: [assetId],
        caption: result.caption,
        hashtags: result.hashtags,
        scheduledAt: result.scheduledAt,
      });

      await this.posts.transition({
        accountId,
        postId: draft.id,
        expectedStatus: "DRAFT",
        expectedVersion: draft.version,
        nextStatus: "PENDING_APPROVAL",
        patch: {
          altText: result.altText,
          ...(result.needsAttention ? { needsAttention: true } : {}),
        },
      });

      return { postId: draft.id };
    } catch (err) {
      // The asset must never be silently lost. Mark it and rethrow so BullMQ
      // retries; after the final attempt the operator sees it in the library.
      await this.assets.markDraftFailed(accountId, assetId);
      this.logger.error(`drafting failed for asset ${assetId}`);
      throw err;
    }
  }
}
