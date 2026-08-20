import type { PostView } from "@/lib/api";
import { formatSlot } from "@/lib/format";
import { approvePost, rejectPost } from "./actions";

export function ApprovalCard({ post, timezone }: { post: PostView; timezone: string }) {
  return (
    <article style={{ border: "1px solid #8883", padding: "1rem", marginBottom: "1rem" }}>
      <p>
        <strong>{post.format}</strong> — {formatSlot(post.scheduledAt, timezone)}
        {post.needsAttention ? <em> · needs a caption</em> : null}
      </p>

      <form action={approvePost}>
        <input type="hidden" name="postId" value={post.id} />
        <input type="hidden" name="accountId" value={post.accountId} />
        <input type="hidden" name="expectedVersion" value={post.version} />
        <label>
          Caption
          <textarea name="caption" defaultValue={post.caption} rows={4} />
        </label>
        <label>
          Hashtags
          <input name="hashtags" defaultValue={post.hashtags.join(" ")} />
        </label>
        <button type="submit">Approve</button>
      </form>

      <form action={rejectPost}>
        <input type="hidden" name="postId" value={post.id} />
        <input type="hidden" name="accountId" value={post.accountId} />
        <input type="hidden" name="expectedVersion" value={post.version} />
        <button type="submit">Reject</button>
      </form>
    </article>
  );
}
