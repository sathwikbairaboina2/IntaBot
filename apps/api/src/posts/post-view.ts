import type { Post } from "@intabot/shared";

/** A publishing post untouched for this long is treated as stuck and may be retried. */
export const RETRY_STUCK_AFTER_MS = 15 * 60 * 1000;

/** Failed posts, and publishing posts that stopped moving, can go back to the queue. */
export function canRetry(post: Post, now: Date): boolean {
  if (post.status === "FAILED") return true;
  if (post.status !== "PUBLISHING") return false;
  return now.getTime() - new Date(post.updatedAt).getTime() > RETRY_STUCK_AFTER_MS;
}

export type PostView = Post & { error: string | null };

/** The post as the control room reads it: the stored fields, plus `error` for the failure reason. */
export function toPostView(post: Post): PostView {
  return { ...post, error: post.failureReason ?? null };
}
