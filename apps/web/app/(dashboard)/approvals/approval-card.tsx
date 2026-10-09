"use client";

import { CheckOutlined, ClockCircleOutlined, EditOutlined } from "@ant-design/icons";
import { Alert, Button, Input } from "antd";
import { useActionState } from "react";
import { ToneTag } from "@/components/ui";
import { hashtagCount } from "@/lib/view";
import { approvePost, rejectPost, type ApprovalActionState } from "./actions";
import type { ApprovalPost } from "./approvals-view";

const IDLE: ApprovalActionState = {};

export function ApprovalCard({ post }: { post: ApprovalPost }) {
  const [approveState, approveAction, approving] = useActionState(approvePost, IDLE);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectPost, IDLE);
  const error = approveState.error ?? rejectState.error;
  const flagged = Boolean(post.needsAttention);

  return (
    <form action={approveAction} className="surface-card approval-card">
      <input type="hidden" name="postId" value={post.id} />
      <input type="hidden" name="accountId" value={post.accountId} />
      <input type="hidden" name="expectedVersion" value={post.version} />

      <div className="card-top">
        <ToneTag tone="neutral">{post.format}</ToneTag>
        <span className="slot">
          <ClockCircleOutlined /> {post.slot}
        </span>
        {flagged ? <ToneTag tone="warn" icon={<EditOutlined />}>Needs a caption</ToneTag> : null}
      </div>

      <label className="field">
        <span>Caption</span>
        <Input.TextArea
          name="caption"
          defaultValue={post.caption}
          autoSize={{ minRows: 3, maxRows: 8 }}
          count={{ show: true, max: 2200 }}
          status={flagged && post.caption.length === 0 ? "warning" : undefined}
          placeholder={flagged ? "Drafting couldn't write a caption. Write one before approving." : "Write a caption"}
        />
      </label>

      <label className="field">
        <span>Hashtags</span>
        <Input name="hashtags" defaultValue={post.hashtags.join(" ")} count={{ show: true, max: 30, strategy: hashtagCount }} />
      </label>

      {error ? <Alert type="error" showIcon title={error} /> : null}

      <div className="card-actions">
        <Button type="primary" htmlType="submit" icon={<CheckOutlined />} loading={approving} disabled={rejecting}>
          Approve
        </Button>
        <Button danger htmlType="submit" formAction={rejectAction} loading={rejecting} disabled={approving}>
          Reject
        </Button>
        <span className="spacer" />
        <span className="version mono">v{post.version}</span>
      </div>
    </form>
  );
}
