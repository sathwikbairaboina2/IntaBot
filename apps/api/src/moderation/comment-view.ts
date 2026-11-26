import type { Comment } from "@intabot/shared";

export interface CommentView {
  /** The Instagram comment id; the panel addresses comments by it. */
  id: string;
  igCommentId: string;
  accountId: string;
  postId: string;
  igMediaId: string;
  author: string;
  authorId: string;
  text: string;
  status: Comment["status"];
  policyRule: string | null;
  replyText: string | null;
  replyId: string | null;
  dmText: string | null;
  dmId: string | null;
  /** sent, failed or skipped; null when no DM was involved. */
  dmState: "sent" | "failed" | "skipped" | null;
  dmError: string | null;
  failureReason: string | null;
  hidden: boolean;
  deleted: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toCommentView(c: Comment): CommentView {
  return {
    id: c.igCommentId,
    igCommentId: c.igCommentId,
    accountId: c.accountId,
    postId: c.postId,
    igMediaId: c.igMediaId,
    author: c.fromUsername,
    authorId: c.fromIgUserId,
    text: c.text,
    status: c.status,
    policyRule: c.policyRule ?? null,
    replyText: c.replyText ?? null,
    replyId: c.replyId ?? null,
    dmText: c.dmText ?? null,
    dmId: c.dmId ?? null,
    dmState: c.dmState ?? null,
    dmError: c.dmError ?? null,
    failureReason: c.failureReason ?? null,
    hidden: c.hidden ?? false,
    deleted: c.deleted ?? false,
    version: c.version,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
