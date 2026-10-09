"use client";

import { SendOutlined } from "@ant-design/icons";
import { Alert, Button, Input } from "antd";
import { useActionState } from "react";
import { dismissComment, replyToComment, type ModerationActionState } from "./actions";
import { ClassificationTags, type CommentItem } from "./moderation-view";

const IDLE: ModerationActionState = {};

export function EscalationCard({ comment, accountUsername }: { comment: CommentItem; accountUsername: string }) {
  const [replyState, replyAction, replying] = useActionState(replyToComment, IDLE);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissComment, IDLE);
  const error = replyState.error ?? dismissState.error;

  return (
    <form action={replyAction} className="surface-card comment-card">
      <input type="hidden" name="igCommentId" value={comment.igCommentId} />
      <input type="hidden" name="accountId" value={comment.accountId} />
      <input type="hidden" name="postId" value={comment.postId} />
      <input type="hidden" name="expectedVersion" value={comment.version} />

      <div className="comment-who">
        <span className="initials">{comment.initials}</span>
        <div>
          <div className="comment-user">@{comment.fromUsername}</div>
          {comment.ago ? <div className="comment-time">{comment.ago}</div> : null}
        </div>
      </div>
      <blockquote className="quote">{comment.text}</blockquote>
      <ClassificationTags comment={comment} />

      {error ? <Alert type="error" showIcon title={error} /> : null}

      <Input.TextArea name="text" required autoSize={{ minRows: 2, maxRows: 6 }} placeholder={`Reply as @${accountUsername}…`} aria-label="Reply" />

      <div className="card-actions">
        <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={replying} disabled={dismissing}>
          Reply
        </Button>
        {/* formNoValidate: dismissing must not require the reply text. */}
        <Button type="text" htmlType="submit" formAction={dismissAction} formNoValidate loading={dismissing} disabled={replying}>
          Dismiss
        </Button>
      </div>
    </form>
  );
}
