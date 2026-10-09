"use client";

import { CheckSquareOutlined, CloudUploadOutlined } from "@ant-design/icons";
import type { PostView } from "@/lib/api";
import { AccountRing, EmptyState, GoButton, LiveNote, ModeTag, ToneTag } from "@/components/ui";
import { ApprovalCard } from "./approval-card";

export type ApprovalPost = PostView & { slot: string };

export interface ApprovalGroup {
  account: { id: string; name: string; username: string; dryRun: boolean };
  posts: ApprovalPost[];
}

export function ApprovalsView({ groups }: { groups: ApprovalGroup[] }) {
  const total = groups.reduce((n, group) => n + group.posts.length, 0);
  if (total === 0) {
    return (
      <EmptyState
        icon={<CheckSquareOutlined />}
        title="Nothing waiting for approval"
        action={<GoButton href="/upload" icon={<CloudUploadOutlined />}>Upload media</GoButton>}
      >
        Drafts show up here a minute or so after you upload media. This page refreshes every 5 seconds.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="page-head">
        <h2>
          {total} {total === 1 ? "draft" : "drafts"} waiting
        </h2>
        <span className="spacer" />
        <LiveNote />
      </div>
      {groups.map(({ account, posts }) => (
        <section key={account.id} className="group" aria-label={`@${account.username}`}>
          <div className="group-head">
            <AccountRing name={account.name} size="sm" />
            <span className="group-user">@{account.username}</span>
            <ToneTag tone="neutral">{posts.length}</ToneTag>
            <ModeTag dryRun={account.dryRun} />
          </div>
          <div className="card-grid">
            {posts.map((post) => (
              // A new version remounts the card so the fields show the latest text.
              <ApprovalCard key={`${post.id}:${post.version}`} post={post} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
