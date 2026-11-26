import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ulid } from "ulid";
import type { Account, Comment } from "@intabot/shared";
import { AccountRepository } from "../accounts/account.repository";
import { AuditRepository } from "../audit/audit.repository";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import { GraphApiError, describeGraphError } from "../instagram/graph-responses";
import {
  CommentPatch,
  CommentRepository,
  CommentTransitionConflictError,
} from "./comment.repository";
import { ReplyCapService } from "./reply-cap.service";

/** Meta only lets a comment be answered with a private reply for this long. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 86_400_000;

/**
 * What an operator (the panel) does to a comment: reply, DM, hide, delete.
 * Each action claims the comment first, makes the Instagram call (skipped in
 * dry run, which records a `dryrun-` id), then records the result and an audit
 * entry. A refused call puts the comment back as it was.
 */
@Injectable()
export class CommentActionsService {
  private readonly logger = new Logger(CommentActionsService.name);

  constructor(
    @Inject(CommentRepository) private readonly comments: CommentRepository,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(INSTAGRAM_PORT) private readonly instagram: InstagramPort,
    @Inject(ReplyCapService) private readonly replyCaps: ReplyCapService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  async reply(postId: string, igCommentId: string, text: string): Promise<Comment> {
    const { comment, account } = await this.load(postId, igCommentId);
    await this.assertUnderCaps(comment, account);
    const updated = await this.act(
      comment,
      "HUMAN_REPLIED",
      { policyRule: "human-replied" },
      async () => {
        const replyId = account.dryRun
          ? `dryrun-${ulid()}`
          : (await this.instagram.replyToComment(account, igCommentId, text)).replyId;
        return { replyText: text, replyId };
      },
    );
    await this.replyCaps.increment(account.id, postId);
    await this.record(account, comment, "comment.reply");
    return updated;
  }

  /**
   * Private reply. Without `text` it resends the stored text of a DM that
   * failed earlier. A comment older than 7 days is refused: Meta rejects those.
   */
  async dm(postId: string, igCommentId: string, text?: string): Promise<Comment> {
    const { comment, account } = await this.load(postId, igCommentId);
    const dmText = text ?? (comment.dmState === "failed" ? comment.dmText : undefined);
    if (!dmText) throw new BadRequestException("text is required");
    if (Date.now() - new Date(comment.createdAt).getTime() > PRIVATE_REPLY_WINDOW_MS) {
      throw new ConflictException(
        "this comment is older than 7 days; Instagram only allows a private reply within 7 days",
      );
    }
    await this.assertUnderCaps(comment, account);
    let refusal: string | null = null;
    let updated: Comment;
    try {
      updated = await this.act(comment, comment.status, {}, async () => {
        if (account.dryRun) return { dmText, dmId: `dryrun-${ulid()}`, dmState: "sent" };
        try {
          const { messageId } = await this.instagram.sendPrivateReply(account, igCommentId, dmText);
          return { dmText, dmId: messageId, dmState: "sent" };
        } catch (err) {
          if (err instanceof GraphApiError) refusal = describeGraphError(err);
          throw err;
        }
      });
    } catch (err) {
      if (refusal) await this.recordDmFailure(comment, dmText, refusal);
      throw err;
    }
    await this.replyCaps.increment(account.id, postId);
    await this.record(account, comment, "comment.dm");
    return updated;
  }

  async hide(postId: string, igCommentId: string, hidden: boolean): Promise<Comment> {
    const { comment, account } = await this.load(postId, igCommentId);
    const updated = await this.act(comment, comment.status, {}, async () => {
      if (!account.dryRun) await this.instagram.hideComment(account, igCommentId, hidden);
      return { hidden };
    });
    await this.record(account, comment, hidden ? "comment.hide" : "comment.unhide");
    return updated;
  }

  async remove(postId: string, igCommentId: string): Promise<Comment> {
    const { comment, account } = await this.load(postId, igCommentId);
    const updated = await this.act(comment, comment.status, {}, async () => {
      if (!account.dryRun) await this.instagram.deleteComment(account, igCommentId);
      return { deleted: true };
    });
    await this.record(account, comment, "comment.delete");
    return updated;
  }

  /** Keeps a refused DM on the comment so it shows as failed and can be resent. */
  private async recordDmFailure(comment: Comment, dmText: string, dmError: string): Promise<void> {
    const current = await this.comments.get(comment.postId, comment.igCommentId);
    if (!current) return;
    await this.transition(current, current.status, current.version, current.status, {
      dmText,
      dmState: "failed",
      dmError,
    }).catch((err: unknown) =>
      this.logger.warn(`could not record failed DM on ${comment.igCommentId}: ${String(err)}`),
    );
  }

  private async load(postId: string, igCommentId: string) {
    const comment = await this.comments.get(postId, igCommentId);
    if (!comment) throw new NotFoundException(`comment not found: ${igCommentId}`);
    if (comment.deleted) throw new ConflictException(`comment ${igCommentId} was deleted`);
    const account = await this.accounts.get(comment.accountId);
    if (!account) throw new NotFoundException(`account not found: ${comment.accountId}`);
    return { comment, account };
  }

  private async assertUnderCaps(comment: Comment, account: Account): Promise<void> {
    const caps = await this.replyCaps.check(account.id, comment.postId, account);
    if (caps.postCapReached || caps.accountCapReached) {
      throw new HttpException(
        caps.postCapReached
          ? "reply cap reached for this post this hour"
          : "reply cap reached for this account this hour",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Claim, run the side effect, record its result; undo the claim if the effect throws. */
  private async act(
    comment: Comment,
    nextStatus: Comment["status"],
    claimPatch: CommentPatch,
    effect: () => Promise<CommentPatch>,
  ): Promise<Comment> {
    const claimed = await this.transition(
      comment,
      comment.status,
      comment.version,
      nextStatus,
      claimPatch,
    );
    let result: CommentPatch;
    try {
      result = await effect();
    } catch (err) {
      await this.transition(comment, nextStatus, claimed.version, comment.status, {}).catch(
        (undoErr: unknown) =>
          this.logger.warn(`could not restore comment ${comment.igCommentId}: ${String(undoErr)}`),
      );
      if (err instanceof GraphApiError) {
        throw new BadGatewayException(`instagram refused: ${err.message}`);
      }
      throw err;
    }
    return this.transition(comment, nextStatus, claimed.version, nextStatus, result);
  }

  private async transition(
    comment: Comment,
    expectedStatus: Comment["status"],
    expectedVersion: number,
    nextStatus: Comment["status"],
    patch: CommentPatch,
  ): Promise<Comment> {
    try {
      return await this.comments.transition({
        postId: comment.postId,
        igCommentId: comment.igCommentId,
        accountId: comment.accountId,
        expectedStatus,
        expectedVersion,
        nextStatus,
        patch,
      });
    } catch (err) {
      if (err instanceof CommentTransitionConflictError) throw new ConflictException(err.message);
      throw err;
    }
  }

  private record(account: Account, comment: Comment, action: string): Promise<void> {
    return this.audit.append({
      accountId: account.id,
      actor: "human",
      action,
      igCommentId: comment.igCommentId,
      postId: comment.postId,
      ...(account.dryRun ? { dryRun: true } : {}),
    });
  }
}
