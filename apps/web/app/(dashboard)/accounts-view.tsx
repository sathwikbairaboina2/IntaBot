"use client";

import {
  CheckCircleOutlined,
  ExperimentOutlined,
  ExportOutlined,
  InstagramOutlined,
  KeyOutlined,
  ReadOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Table, type TableColumnsType } from "antd";
import type { HTMLAttributes, ReactNode } from "react";
import { AccountRing, EmptyState, ModeTag, StatusDot, ToneTag } from "@/components/ui";
import type { AccountStats, Expiry, Tone } from "@/lib/view";

export interface AccountRow {
  id: string;
  name: string;
  username: string;
  status: { label: string; tone: Tone };
  dryRun: boolean;
  moderationPaused: boolean;
  expiresOn: string;
  expiry: Expiry;
}

function Stat({ icon, label, value, sub, warn }: { icon: ReactNode; label: string; value: number; sub: string; warn?: boolean }) {
  return (
    <div className={`stat-tile${warn ? " warn" : ""}`}>
      <div className="stat-label">{icon}{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

// The phone layout shows each row as a card and names every cell from this attribute.
const label = (name: string) => () => ({ "data-label": name }) as HTMLAttributes<HTMLElement>;

const columns: TableColumnsType<AccountRow> = [
  {
    title: "Account",
    key: "account",
    render: (_, row) => (
      <div className="acct">
        <AccountRing name={row.name} />
        <div>
          <div className="acct-name">{row.name}</div>
          <div className="acct-user">@{row.username}</div>
        </div>
      </div>
    ),
  },
  { title: "Status", key: "status", onCell: label("Status"), render: (_, row) => <StatusDot tone={row.status.tone}>{row.status.label}</StatusDot> },
  { title: "Mode", key: "mode", onCell: label("Mode"), render: (_, row) => <ModeTag dryRun={row.dryRun} /> },
  {
    title: "Moderation",
    key: "moderation",
    onCell: label("Moderation"),
    render: (_, row) => (row.moderationPaused ? <ToneTag tone="neutral">Paused</ToneTag> : <span className="muted">On</span>),
  },
  {
    title: "Token expires",
    key: "expiry",
    onCell: label("Token expires"),
    render: (_, row) => (
      <div className={`expiry-${row.expiry.level}`}>
        <div className="num">{row.expiresOn}</div>
        <div className="expiry-label">{row.expiry.label}</div>
      </div>
    ),
  },
];

export function AccountsView({ rows, stats, docsUrl }: { rows: AccountRow[]; stats: AccountStats; docsUrl: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<InstagramOutlined />}
        title="No Instagram account connected"
        action={<Button type="primary" icon={<ReadOutlined />} href={docsUrl} target="_blank">Open API docs</Button>}
      >
        Accounts are added through the IntaBot API. Open the API docs, sign in, and call <code>POST /accounts</code> with the
        account&apos;s access token.
      </EmptyState>
    );
  }

  const inactive = stats.total - stats.active;
  return (
    <>
      <div className="stat-grid">
        <Stat icon={<TeamOutlined />} label="Accounts" value={stats.total} sub="connected" />
        <Stat icon={<CheckCircleOutlined />} label="Active" value={stats.active} sub={inactive > 0 ? `${inactive} not active` : "all active"} />
        <Stat icon={<ExperimentOutlined />} label="Dry run" value={stats.dryRun} sub="won't publish" />
        <Stat icon={<KeyOutlined />} label="Tokens" value={stats.tokensDue} sub="expired or due in 14 days" warn={stats.tokensDue > 0} />
      </div>
      <div className="page-head">
        <h2>Connected accounts</h2>
        <span className="spacer" />
        <a className="text-link" href={docsUrl} target="_blank" rel="noreferrer">
          <ReadOutlined /> Add accounts in the API docs <ExportOutlined />
        </a>
      </div>
      <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} className="surface-table" />
    </>
  );
}
