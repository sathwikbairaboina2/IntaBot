"use client";

import {
  CheckSquareOutlined,
  CloudUploadOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  MessageOutlined,
  MoonOutlined,
  RobotOutlined,
  SunOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Layout } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { logout } from "@/app/(dashboard)/actions";
import type { NavCounts } from "@/lib/queries";
import { useTheme } from "./theme-provider";
import { ToneTag } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  count: number | null;
}

function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
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
  const items: NavItem[] = [
    { href: "/", label: "Accounts", icon: <TeamOutlined />, count: null },
    { href: "/approvals", label: "Approvals", icon: <CheckSquareOutlined />, count: counts.approvals },
    { href: "/upload", label: "Upload", icon: <CloudUploadOutlined />, count: null },
    { href: "/moderation", label: "Moderation", icon: <MessageOutlined />, count: counts.moderation },
  ];
  const active = items.find((item) => isActive(item.href, pathname));

  return (
    <Layout className="shell">
      <Layout.Sider width={208} className="shell-sider">
        <div className="shell-logo">
          <span className="logo-square"><RobotOutlined /></span>
          <span className="wordmark">insta<span className="grad-text">bot</span></span>
        </div>
        <nav className="shell-nav" aria-label="Main">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${item === active ? " active" : ""}`}
              aria-current={item === active ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.count ? <span className="nav-count">{item.count}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="shell-foot">
          <div className="shell-me">
            <span className="initials">{email.charAt(0).toUpperCase()}</span>
            <div style={{ minWidth: 0 }}>
              <div className="shell-email" title={email}>{email}</div>
              <div className="shell-role">Operator</div>
            </div>
          </div>
          <form action={logout}>
            <Button type="text" htmlType="submit" icon={<LogoutOutlined />} block className="shell-logout">
              Log out
            </Button>
          </form>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="shell-top">
          <h1>{active?.label ?? "instabot"}</h1>
          <span className="spacer" />
          {dryRunAccounts > 0 ? (
            <ToneTag tone="warn" icon={<ExperimentOutlined />}>
              Dry run · {dryRunAccounts} {dryRunAccounts === 1 ? "account" : "accounts"}
            </ToneTag>
          ) : null}
          <Button
            type="text"
            icon={theme === "dark" ? <MoonOutlined /> : <SunOutlined />}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "Dark" : "Light"}
          </Button>
        </Layout.Header>
        <Layout.Content className="shell-content">
          <div className="page">{children}</div>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
