"use client";

import { MessageOutlined, PauseCircleOutlined } from "@ant-design/icons";
import { Alert } from "antd";
import type { CommentView } from "@/lib/api";
import { intentTone, sentimentTone } from "@/lib/view";
import { AccountRing, EmptyState, LiveNote, ToneTag } from "@/components/ui";
import { EscalationCard } from "./escalation-card";

export type CommentItem = CommentView & { initials: string; ago: string };

export interface ModerationGroup {
  account: { id: string; name: string; username: string; moderationPaused: boolean };
  escalated: CommentItem[];
  autoReplies: CommentItem[];
}

export function ClassificationTags({ comment }: { comment: CommentView }) {
  const c = comment.classification;
  return (
    <div className="tag-row">
      {c ? (
        <>
          <ToneTag tone={intentTone(c.intent)}>{c.intent}</ToneTag>
          <ToneTag tone={sentimentTone(c.sentiment)}>{c.sentiment}</ToneTag>
          {c.needsHuman ? <ToneTag tone="accent">Needs human</ToneTag> : null}
        </>
      ) : (
        <ToneTag tone="neutral">unclassified</ToneTag>
      )}
      {comment.policyRule ? <ToneTag tone="neutral" mono>rule: {comment.policyRule}</ToneTag> : null}
    </div>
  );
}

function PausedAlert({ username }: { username: string }) {
  return (
    <Alert
      className="paused-alert"
      type="warning"
      showIcon
      icon={<PauseCircleOutlined />}
      title={
        <>
          <b>Moderation is paused for @{username}.</b> New comments are still classified, but no replies are sent.
        </>
      }
    />
  );
}

export function ModerationView({ groups }: { groups: ModerationGroup[] }) {
  const waiting = groups.reduce((n, g) => n + g.escalated.length, 0);
  const autoReplies = groups.reduce((n, g) => n + g.autoReplies.length, 0);
  const paused = groups.filter((g) => g.account.moderationPaused);

  if (waiting + autoReplies === 0) {
    return (
      <>
        {paused.map((g) => (
          <PausedAlert key={g.account.id} username={g.account.username} />
        ))}
        <EmptyState icon={<MessageOutlined />} title="No comments yet">
          New comments on your posts are classified as they arrive. The ones that need you will wait here.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h2>{waiting} waiting for you</h2>
        <span className="sub">
          {autoReplies} recent {autoReplies === 1 ? "auto-reply" : "auto-replies"}
        </span>
        <span className="spacer" />
        <LiveNote />
      </div>
      {groups
        .filter((g) => g.escalated.length + g.autoReplies.length > 0 || g.account.moderationPaused)
        .map(({ account, escalated, autoReplies: replies }) => (
          <section key={account.id} className="group" aria-label={`@${account.username}`}>
            <div className="group-head">
              <AccountRing name={account.name} size="sm" />
              <span className="group-user">@{account.username}</span>
            </div>
            {account.moderationPaused ? <PausedAlert username={account.username} /> : null}
            {escalated.length > 0 ? (
              <>
                <div className="micro">Waiting for you</div>
                <div className="card-grid" style={{ marginBottom: 22 }}>
                  {escalated.map((comment) => (
                    <EscalationCard key={`${comment.igCommentId}:${comment.version}`} comment={comment} accountUsername={account.username} />
                  ))}
                </div>
              </>
            ) : null}
            {replies.length > 0 ? (
              <>
                <div className="micro">Recent auto-replies</div>
                <div className="surface-card auto-list">
                  {replies.map((comment) => (
                    <div key={comment.igCommentId} className="auto-row">
                      <span className="initials">{comment.initials}</span>
                      <div className="auto-text">
                        <b>@{comment.fromUsername}</b> {comment.text}
                        {comment.replyText ? <div className="auto-reply">{comment.replyText}</div> : null}
                      </div>
                      <div className="auto-meta">
                        {comment.classification ? (
                          <ToneTag tone={intentTone(comment.classification.intent)}>{comment.classification.intent}</ToneTag>
                        ) : null}
                        <span className="num">{comment.ago}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ))}
    </>
  );
}
