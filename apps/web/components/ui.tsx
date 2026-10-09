"use client";

import {
  ArrowLeftOutlined,
  DisconnectOutlined,
  ExperimentOutlined,
  LinkOutlined,
  ReloadOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Skeleton, Tag } from "antd";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { API_BASE_URL } from "@/lib/http";
import type { Tone } from "@/lib/view";

export function ToneTag({ tone, icon, mono, children }: { tone: Tone; icon?: ReactNode; mono?: boolean; children: ReactNode }) {
  return (
    <Tag variant="filled" icon={icon} className={`tone tone-${tone}${mono ? " tag-mono" : ""}`}>
      {children}
    </Tag>
  );
}

export function ModeTag({ dryRun }: { dryRun: boolean }) {
  return dryRun ? (
    <ToneTag tone="warn" icon={<ExperimentOutlined />}>Dry run</ToneTag>
  ) : (
    <ToneTag tone="accent" icon={<ThunderboltOutlined />}>Live</ToneTag>
  );
}

export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`status status-${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

export function AccountRing({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span className={`ring${size === "sm" ? " ring-sm" : ""}`} aria-hidden="true">
      <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>
    </span>
  );
}

export function GoButton({ href, icon, primary = true, children }: { href: string; icon?: ReactNode; primary?: boolean; children: ReactNode }) {
  const router = useRouter();
  return (
    <Button type={primary ? "primary" : "default"} icon={icon} onClick={() => router.push(href)}>
      {children}
    </Button>
  );
}

export function LiveNote() {
  return (
    <span className="live">
      <span className="dot" />
      Refreshes every 5 s
    </span>
  );
}

export function EmptyState({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function NeedAccount() {
  return (
    <EmptyState icon={<LinkOutlined />} title="Connect an account first" action={<GoButton href="/" icon={<TeamOutlined />}>Go to Accounts</GoButton>}>
      Upload, Approvals and Moderation work per Instagram account. Add one, then come back.
    </EmptyState>
  );
}

export function ErrorView({ digest, reset }: { digest?: string; reset: () => void }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();
  const host = API_BASE_URL.replace(/^https?:\/\//, "");
  // reset() alone re-renders the failed server result; refresh fetches it again first.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <EmptyState
      icon={<DisconnectOutlined />}
      title="Something went wrong loading this page"
      action={<Button type="primary" icon={<ReloadOutlined />} loading={retrying} onClick={retry}>Retry</Button>}
    >
      If the IntaBot API ({host}) isn&apos;t running, start it with <code>pnpm dev</code>, then retry.
      {digest ? <span className="dim mono"> Ref {digest}</span> : null}
    </EmptyState>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="stat-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat-tile">
            <Skeleton active title={false} paragraph={{ rows: 2, width: ["60%", "40%"] }} />
          </div>
        ))}
      </div>
      <div className="surface-card skeleton-rows">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} active avatar title={false} paragraph={{ rows: 1, width: "80%" }} />
        ))}
      </div>
    </div>
  );
}

export function NotFoundView() {
  return (
    <main className="center-page">
      <div className="empty">
        <div className="big-404 grad-text">404</div>
        <h3>This page doesn&apos;t exist</h3>
        <p>The link may be old, or the post was already published.</p>
        <GoButton href="/" primary={false} icon={<ArrowLeftOutlined />}>Back to Accounts</GoButton>
      </div>
    </main>
  );
}
