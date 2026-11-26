import type { Post } from "@intabot/shared";

/** The caption Instagram receives: the post's text, then its hashtags after a blank line. */
export function publishCaption(post: Pick<Post, "caption" | "hashtags">): string {
  return [post.caption, post.hashtags.join(" ")].filter(Boolean).join("\n\n");
}
