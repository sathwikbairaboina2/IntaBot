"use client";

import { useActionState } from "react";
import type { CommentView } from "@/lib/api";
import {
  dismissComment,
  replyToComment,
  type ModerationActionState,
} from "./actions";

function Chips({ comment }: { comment: CommentView }) {
  const c = comment.classification;
  return (
    <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
      {c ? `${c.intent} · ${c.sentiment}${c.needsHuman ? " · needs human" : ""}` : "unclassified"}
      {comment.policyRule ? ` · rule: ${comment.policyRule}` : null}
    </p>
  );
}

export function EscalationCard({ comment }: { comment: CommentView }) {
  const [replyState, replyAction] = useActionState<ModerationActionState, FormData>(
    replyToComment,
    {},
  );
  const [dismissState, dismissAction] = useActionState<ModerationActionState, FormData>(
    dismissComment,
    {},
  );
  const error = replyState.error ?? dismissState.error;

  return (
    <article style={{ border: "1px solid #8883", padding: "1rem", marginBottom: "1rem" }}>
      <p>
        <strong>@{comment.fromUsername}</strong>: {comment.text}
      </p>
      <Chips comment={comment} />
      {error ? <p role="alert">{error}</p> : null}

      <form action={replyAction}>
        <input type="hidden" name="igCommentId" value={comment.igCommentId} />
        <input type="hidden" name="accountId" value={comment.accountId} />
        <input type="hidden" name="postId" value={comment.postId} />
        <input type="hidden" name="expectedVersion" value={comment.version} />
        <label>
          Reply
          <textarea name="text" rows={3} required />
        </label>
        <button type="submit">Reply</button>
      </form>

      <form action={dismissAction}>
        <input type="hidden" name="igCommentId" value={comment.igCommentId} />
        <input type="hidden" name="accountId" value={comment.accountId} />
        <input type="hidden" name="postId" value={comment.postId} />
        <input type="hidden" name="expectedVersion" value={comment.version} />
        <button type="submit">Dismiss</button>
      </form>
    </article>
  );
}
