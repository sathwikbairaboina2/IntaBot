import { Inject, Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import type { Account, Classification, Comment } from "@intabot/shared";
import { AccountRepository } from "../accounts/account.repository";
import { AuditRepository } from "../audit/audit.repository";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import {
  COMMENT_CLASSIFIER,
  type CommentClassifierPort,
} from "../moderation/comment-classifier.port";
import {
  CommentRepository,
  CommentTransitionConflictError,
} from "../moderation/comment.repository";
import { IgMediaRefRepository } from "../moderation/ig-media-ref.repository";
import { isLinkRequest } from "../moderation/link-request";
import { policyGate } from "../moderation/policy-gate";
import { ReplyCapService } from "../moderation/reply-cap.service";
import { REPLY_WRITER, type ReplyWriterPort } from "../moderation/reply-writer.port";
import { ReplyRefusalError } from "../moderation/reply-writer.port";
import { PostRepository } from "../posts/post.repository";

export interface ModerationJobData {
  accountId: string;
  igCommentId: string;
  igMediaId: string;
  fromIgUserId: string;
  fromUsername: string;
  text: string;
}

export const LINK_REQUEST_RULE = "link-request";
export const LINK_REQUEST_REPLY = "Sent you the link in your DMs.";

/** Stands in for the model's verdict so the gate's paused/blocklist/cap rules
 * still apply to a keyword comment that never reaches the classifier. */
const NEUTRAL_CLASSIFICATION: Classification = {
  sentiment: "neutral",
  intent: "question",
  toxicity: 0,
  isSpam: false,
  needsHuman: false,
};

export type ModerationOutcome =
  | "unknown-media"
  | "duplicate"
  | "already-claimed"
  | "replied"
  | "escalated"
  | "ignored";

@Injectable()
export class ModerationProcessor {
  private readonly logger = new Logger(ModerationProcessor.name);

  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(CommentRepository) private readonly comments: CommentRepository,
    @Inject(IgMediaRefRepository) private readonly igMediaRefs: IgMediaRefRepository,
    @Inject(COMMENT_CLASSIFIER) private readonly classifier: CommentClassifierPort,
    @Inject(REPLY_WRITER) private readonly replyWriter: ReplyWriterPort,
    @Inject(ReplyCapService) private readonly replyCaps: ReplyCapService,
    @Inject(INSTAGRAM_PORT) private readonly instagram: InstagramPort,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  async process(data: ModerationJobData): Promise<{ outcome: ModerationOutcome }> {
    const ref = await this.igMediaRefs.get(data.igMediaId);
    if (!ref) {
      // Comments on media IntaBot did not publish are out of scope.
      this.logger.log(`no post owns ig media ${data.igMediaId} - ignoring comment`);
      return { outcome: "unknown-media" };
    }

    const account = await this.accounts.get(ref.accountId);
    if (!account) throw new Error(`account not found: ${ref.accountId}`);

    const comment = await this.comments.create({
      igCommentId: data.igCommentId,
      accountId: ref.accountId,
      postId: ref.postId,
      igMediaId: data.igMediaId,
      text: data.text,
      fromIgUserId: data.fromIgUserId,
      fromUsername: data.fromUsername,
    });
    if (!comment) return { outcome: "duplicate" };

    // The self-reply guard runs before the model: the account's own comment
    // (our own reply, echoed back by the webhook) must never be classified,
    // let alone answered.
    if (data.fromIgUserId === account.igUserId) {
      return this.settle(account, comment, "IGNORED", "self-reply-guard", null);
    }

    const post = await this.posts.get(ref.accountId, ref.postId);
    const postCaption = post?.caption ?? "";

    // A keyword comment on a post with an apply link is answered by a fixed
    // rule, not the model: public reply plus a private DM with the link.
    if (post?.applyUrl && isLinkRequest(data.text, account.linkKeyword ?? "LINK")) {
      const caps = await this.replyCaps.check(account.id, ref.postId, account);
      const verdict = policyGate({
        account,
        fromIgUserId: data.fromIgUserId,
        commentText: data.text,
        classification: NEUTRAL_CLASSIFICATION,
        ...caps,
      });
      if (verdict.action === "escalate") {
        return this.settle(account, comment, "ESCALATED", verdict.rule, null);
      }
      if (verdict.action === "ignore") {
        return this.settle(account, comment, "IGNORED", verdict.rule, null);
      }
      return this.replyWithLink(account, comment, post.applyUrl);
    }

    const classification = await this.classifier.classify({
      commentText: data.text,
      postCaption,
      accountVoice: account.voice ?? "clear, friendly, specific",
    });

    const caps = await this.replyCaps.check(account.id, ref.postId, account);
    const verdict = policyGate({
      account,
      fromIgUserId: data.fromIgUserId,
      commentText: data.text,
      classification,
      ...caps,
    });

    if (verdict.action === "escalate") {
      return this.settle(account, comment, "ESCALATED", verdict.rule, classification);
    }
    if (verdict.action === "ignore") {
      return this.settle(account, comment, "IGNORED", verdict.rule, classification);
    }

    return this.reply(account, comment, classification, postCaption, verdict.rule);
  }

  /** Claim first, then the public reply and the DM; a duplicated job does neither twice. */
  private async replyWithLink(
    account: Account,
    comment: Comment,
    applyUrl: string,
  ): Promise<{ outcome: ModerationOutcome }> {
    let claimed: Comment;
    try {
      claimed = await this.comments.transition({
        postId: comment.postId,
        igCommentId: comment.igCommentId,
        accountId: comment.accountId,
        expectedStatus: "RECEIVED",
        expectedVersion: comment.version,
        nextStatus: "AUTO_REPLIED",
        patch: { policyRule: LINK_REQUEST_RULE },
      });
    } catch (err) {
      if (err instanceof CommentTransitionConflictError) {
        this.logger.log(`comment ${comment.igCommentId} already claimed - skipping`);
        return { outcome: "already-claimed" };
      }
      throw err;
    }

    const replyText = LINK_REQUEST_REPLY;
    const dmText = `Here is the apply link: ${applyUrl}`;
    let replyId: string;
    let dmId: string;
    if (account.dryRun) {
      replyId = `dryrun-${ulid()}`;
      dmId = `dryrun-${ulid()}`;
    } else {
      replyId = (await this.instagram.replyToComment(account, comment.igCommentId, replyText))
        .replyId;
      dmId = (await this.instagram.sendPrivateReply(account, comment.igCommentId, dmText))
        .messageId;
    }

    await this.comments.transition({
      postId: comment.postId,
      igCommentId: comment.igCommentId,
      accountId: comment.accountId,
      expectedStatus: "AUTO_REPLIED",
      expectedVersion: claimed.version,
      nextStatus: "AUTO_REPLIED",
      patch: { replyText, replyId, dmText, dmId },
    });
    await this.replyCaps.increment(account.id, comment.postId);
    await this.appendAudit(account, comment, "comment.link-request", LINK_REQUEST_RULE, null);
    return { outcome: "replied" };
  }

  /** Claim first, side-effect second — a duplicated job replies at most once. */
  private async reply(
    account: Account,
    comment: Comment,
    classification: Classification,
    postCaption: string,
    rule: string,
  ): Promise<{ outcome: ModerationOutcome }> {
    let claimed: Comment;
    try {
      claimed = await this.comments.transition({
        postId: comment.postId,
        igCommentId: comment.igCommentId,
        accountId: comment.accountId,
        expectedStatus: "RECEIVED",
        expectedVersion: comment.version,
        nextStatus: "AUTO_REPLIED",
        patch: { classification, policyRule: rule },
      });
    } catch (err) {
      if (err instanceof CommentTransitionConflictError) {
        this.logger.log(`comment ${comment.igCommentId} already claimed - skipping`);
        return { outcome: "already-claimed" };
      }
      throw err;
    }

    let replyText: string;
    try {
      const draft = await this.replyWriter.draftReply({
        commentText: comment.text,
        classification,
        postCaption,
        accountVoice: account.voice ?? "clear, friendly, specific",
      });
      replyText = draft.text;
    } catch (err) {
      if (err instanceof ReplyRefusalError) {
        await this.comments.transition({
          postId: comment.postId,
          igCommentId: comment.igCommentId,
          accountId: comment.accountId,
          expectedStatus: "AUTO_REPLIED",
          expectedVersion: claimed.version,
          nextStatus: "ESCALATED",
          patch: { policyRule: "reply-refused" },
        });
        await this.appendAudit(account, comment, "ESCALATED", "reply-refused", classification);
        return { outcome: "escalated" };
      }
      throw err;
    }

    const replyId = account.dryRun
      ? `dryrun-${ulid()}`
      : (await this.instagram.replyToComment(account, comment.igCommentId, replyText)).replyId;

    await this.comments.transition({
      postId: comment.postId,
      igCommentId: comment.igCommentId,
      accountId: comment.accountId,
      expectedStatus: "AUTO_REPLIED",
      expectedVersion: claimed.version,
      nextStatus: "AUTO_REPLIED",
      patch: { replyText, replyId },
    });
    await this.replyCaps.increment(account.id, comment.postId);
    await this.appendAudit(account, comment, "AUTO_REPLIED", rule, classification);
    return { outcome: "replied" };
  }

  private async settle(
    account: Account,
    comment: Comment,
    status: "ESCALATED" | "IGNORED",
    rule: string,
    classification: Classification | null,
  ): Promise<{ outcome: ModerationOutcome }> {
    try {
      await this.comments.transition({
        postId: comment.postId,
        igCommentId: comment.igCommentId,
        accountId: comment.accountId,
        expectedStatus: "RECEIVED",
        expectedVersion: comment.version,
        nextStatus: status,
        patch: {
          policyRule: rule,
          ...(classification ? { classification } : {}),
        },
      });
    } catch (err) {
      if (err instanceof CommentTransitionConflictError) return { outcome: "already-claimed" };
      throw err;
    }
    await this.appendAudit(account, comment, status, rule, classification);
    return { outcome: status === "ESCALATED" ? "escalated" : "ignored" };
  }

  private async appendAudit(
    account: Account,
    comment: Comment,
    action: string,
    rule: string,
    classification: Classification | null,
  ): Promise<void> {
    await this.audit.append({
      accountId: account.id,
      actor: "agent",
      action,
      rule,
      igCommentId: comment.igCommentId,
      postId: comment.postId,
      ...(classification
        ? { classificationSummary: `${classification.intent}/${classification.sentiment}` }
        : {}),
      ...(account.dryRun ? { dryRun: true } : {}),
    });
  }
}
