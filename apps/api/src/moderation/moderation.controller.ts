import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { Comment } from "@intabot/shared";
import { ulid } from "ulid";
import { z } from "zod";
import { AccountRepository } from "../accounts/account.repository";
import { AuditRepository } from "../audit/audit.repository";
import { AuthGuard } from "../auth/auth.guard";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import { CommentRepository, CommentTransitionConflictError } from "./comment.repository";
import { ReplyCapService } from "./reply-cap.service";

const RECENT_AUTO_REPLIES = 20;

const ReplyBody = z.object({
  accountId: z.string().min(1),
  postId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
  text: z.string().min(1),
});

const DismissBody = ReplyBody.omit({ text: true });

export interface ModerationView {
  escalated: Comment[];
  recentAutoReplies: Comment[];
}

@Controller("moderation")
@UseGuards(AuthGuard)
export class ModerationController {
  private readonly logger = new Logger(ModerationController.name);

  constructor(
    @Inject(CommentRepository) private readonly comments: CommentRepository,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(INSTAGRAM_PORT) private readonly instagram: InstagramPort,
    @Inject(ReplyCapService) private readonly replyCaps: ReplyCapService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  @Get()
  async list(@Query("accountId") accountId?: string): Promise<ModerationView> {
    if (!accountId) throw new BadRequestException("accountId is required");
    const [escalated, recentAutoReplies] = await Promise.all([
      this.comments.listByStatus(accountId, "ESCALATED"),
      this.comments.listByStatus(accountId, "AUTO_REPLIED", {
        newestFirst: true,
        limit: RECENT_AUTO_REPLIES,
      }),
    ]);
    return { escalated, recentAutoReplies };
  }

  @Post(":igCommentId/reply")
  @HttpCode(200)
  async reply(@Param("igCommentId") igCommentId: string, @Body() body: unknown): Promise<Comment> {
    const parsed = ReplyBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { accountId, postId, expectedVersion, text } = parsed.data;

    const account = await this.accounts.get(accountId);
    if (!account) throw new BadRequestException(`account not found: ${accountId}`);

    // Claim before the side effect, exactly like the auto-reply path: a stale
    // version means another tab or worker got here first.
    let claimed: Comment;
    try {
      claimed = await this.comments.transition({
        postId,
        igCommentId,
        accountId,
        expectedStatus: "ESCALATED",
        expectedVersion,
        nextStatus: "HUMAN_REPLIED",
        patch: { policyRule: "human-replied" },
      });
    } catch (err) {
      if (err instanceof CommentTransitionConflictError) throw new ConflictException(err.message);
      throw err;
    }

    const replyId = account.dryRun
      ? `dryrun-${ulid()}`
      : (await this.instagram.replyToComment(account, igCommentId, text)).replyId;

    const updated = await this.comments.transition({
      postId,
      igCommentId,
      accountId,
      expectedStatus: "HUMAN_REPLIED",
      expectedVersion: claimed.version,
      nextStatus: "HUMAN_REPLIED",
      patch: { replyText: text, replyId },
    });
    await this.replyCaps.increment(accountId, postId);
    await this.audit.append({
      accountId,
      actor: "human",
      action: "HUMAN_REPLIED",
      igCommentId,
      postId,
      ...(account.dryRun ? { dryRun: true } : {}),
    });
    return updated;
  }

  @Post(":igCommentId/dismiss")
  @HttpCode(200)
  async dismiss(@Param("igCommentId") igCommentId: string, @Body() body: unknown): Promise<Comment> {
    const parsed = DismissBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { accountId, postId, expectedVersion } = parsed.data;

    try {
      const updated = await this.comments.transition({
        postId,
        igCommentId,
        accountId,
        expectedStatus: "ESCALATED",
        expectedVersion,
        nextStatus: "IGNORED",
        patch: { policyRule: "human-dismissed" },
      });
      await this.audit.append({
        accountId,
        actor: "human",
        action: "IGNORED",
        rule: "human-dismissed",
        igCommentId,
        postId,
      });
      return updated;
    } catch (err) {
      if (err instanceof CommentTransitionConflictError) throw new ConflictException(err.message);
      throw err;
    }
  }
}
