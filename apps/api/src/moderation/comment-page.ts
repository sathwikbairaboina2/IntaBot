import type { Comment } from "@intabot/shared";

export interface CommentPageOptions {
  /** Keep comments created at or after this instant. */
  since?: string | undefined;
  /** Keep comments created strictly before this instant: the previous page's cursor. */
  before?: string | undefined;
  limit: number;
}

export interface CommentPage {
  items: Comment[];
  /** Pass as `before` for the next page; null when this was the last one. */
  nextCursor: string | null;
}

/** Newest-first page over comments already narrowed to one account (and status). */
export function pageComments(comments: Comment[], opts: CommentPageOptions): CommentPage {
  const matching = comments
    .filter((c) => (!opts.since || c.createdAt >= opts.since) && (!opts.before || c.createdAt < opts.before))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.igCommentId.localeCompare(a.igCommentId));
  const items = matching.slice(0, opts.limit);
  const more = matching.length > items.length;
  return { items, nextCursor: more ? items[items.length - 1]!.createdAt : null };
}
