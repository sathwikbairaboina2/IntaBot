"use client";

import {
  CheckSquareOutlined,
  CloudUploadOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  MoonOutlined,
  RobotOutlined,
  SunOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Layout } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { logout } from "@/app/(dashboard)/actions";
import { activeEntry, countLabel, menuButtonLabel, menuStaysOpen, navEntries, waitingTotal } from "@/lib/nav";
import type { NavCounts } from "@/lib/queries";
import { usePhone } from "@/lib/use-media";
import { useTheme } from "./theme-provider";
import { ToneTag } from "./ui";

const ICONS: Record<string, ReactNode> = {
  "/": <TeamOutlined />,
  "/approvals": <CheckSquareOutlined />,
  "/upload": <CloudUploadOutlined />,
  "/moderation": <MessageOutlined />,
};

function Brand() {
  return (
    <>
      <span className="logo-square"><RobotOutlined /></span>
      <span className="wordmark">insta<span className="grad-text">bot</span></span>
    </>
  );
}

function NavLinks({ counts, pathname, onNavigate }: { counts: NavCounts; pathname: string; onNavigate?: () => void }) {
  const entries = navEntries(counts);
  const active = activeEntry(entries, pathname);
  return (
    <nav className="shell-nav" aria-label="Main">
      {entries.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          className={`nav-item${entry === active ? " active" : ""}`}
          aria-current={entry === active ? "page" : undefined}
          onClick={onNavigate}
        >
          {ICONS[entry.href]}
          <span>{entry.label}</span>
          {entry.count ? <span className="nav-count">{countLabel(entry.count)}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

function Me({ email }: { email: string }) {
  return (
    <div className="shell-me">
      <span className="initials">{email.charAt(0).toUpperCase()}</span>
      <div style={{ minWidth: 0 }}>
        <div className="shell-email" title={email}>{email}</div>
        <div className="shell-role">Operator</div>
      </div>
    </div>
  );
}

function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="text" htmlType="submit" icon={<LogoutOutlined />} block className="shell-logout">
        Log out
      </Button>
    </form>
  );
}

export function AppShell({
  email,
  counts,
  dryRunAccounts,
  children,
}: {
  email: string;
  counts: NavCounts;
  dryRunAccounts: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const phone = usePhone();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const lastPath = useRef(pathname);
  const active = activeEntry(navEntries(counts), pathname);
  const waiting = waitingTotal(counts);

  // A route change or a window grown past the phone width leaves the menu nothing to show.
  useEffect(() => {
    const from = lastPath.current;
    lastPath.current = pathname;
    setMenuOpen((open) => menuStaysOpen({ open, phone, from, to: pathname }));
  }, [pathname, phone]);

  // Focus goes back to the button that opened the menu, however it closed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !menuOpen) menuButton.current?.focus();
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  const nextTheme = theme === "dark" ? "light" : "dark";
  const themeIcon = theme === "dark" ? <MoonOutlined /> : <SunOutlined />;

  return (
    <Layout className="shell">
      <Layout.Sider width={208} className="shell-sider">
        <div className="shell-logo"><Brand /></div>
        <NavLinks counts={counts} pathname={pathname} />
        <div className="shell-foot">
          <Me email={email} />
          <LogoutButton />
        </div>
      </Layout.Sider>
      <Layout className="shell-main">
        <Layout.Header className="shell-top">
          <Button
            ref={menuButton}
            type="text"
            className="menu-btn"
            data-testid="mobile-menu"
            aria-label={menuButtonLabel(counts)}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            icon={<MenuOutlined />}
            onClick={() => setMenuOpen(true)}
          >
            {waiting > 0 ? <span className="menu-badge" aria-hidden="true">{countLabel(waiting)}</span> : null}
          </Button>
          <h1>{active?.label ?? "instabot"}</h1>
          <span className="spacer" />
          {dryRunAccounts > 0 ? (
            <span className="dryrun-tag">
              <ToneTag tone="warn" icon={<ExperimentOutlined />}>
                {/* Phones show the short label; the full text stays for screen readers. */}
                <span className="dr-full">
                  Dry run · {dryRunAccounts} {dryRunAccounts === 1 ? "account" : "accounts"}
                </span>
                <span className="dr-short" aria-hidden="true">Dry run</span>
              </ToneTag>
            </span>
          ) : null}
          <Button
            type="text"
            className="theme-btn"
            icon={themeIcon}
            onClick={() => setTheme(nextTheme)}
            aria-label={`Switch to ${nextTheme} theme`}
          >
            <span className="theme-label">{theme === "dark" ? "Dark" : "Light"}</span>
          </Button>
        </Layout.Header>
        <Layout.Content className="shell-content">
          <div className="page">{children}</div>
        </Layout.Content>
      </Layout>

      <Drawer
        rootClassName="nav-drawer"
        placement="left"
        size={300}
        open={menuOpen && phone}
        onClose={() => setMenuOpen(false)}
        destroyOnHidden
        closable
        title={<span className="drawer-brand"><Brand /></span>}
        styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
      >
        <NavLinks counts={counts} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
        <div className="shell-foot">
          <Me email={email} />
          <Button
            type="text"
            block
            className="shell-logout"
            icon={themeIcon}
            onClick={() => setTheme(nextTheme)}
          >
            {theme === "dark" ? "Dark theme" : "Light theme"}
          </Button>
          <LogoutButton />
        </div>
      </Drawer>
    </Layout>
  );
}
