import type { NavCounts } from "./queries";

export interface NavEntry {
  href: string;
  label: string;
  /** Items waiting on the operator; null where the screen has no queue. */
  count: number | null;
}

export function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function navEntries(counts: NavCounts): NavEntry[] {
  return [
    { href: "/", label: "Accounts", count: null },
    { href: "/approvals", label: "Approvals", count: counts.approvals ?? 0 },
    { href: "/upload", label: "Upload", count: null },
    { href: "/moderation", label: "Moderation", count: counts.moderation ?? 0 },
  ];
}

export function activeEntry(entries: NavEntry[], pathname: string): NavEntry | undefined {
  return entries.find((entry) => isActive(entry.href, pathname));
}

export function countLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

export function waitingTotal(counts: NavCounts): number {
  return (counts.approvals ?? 0) + (counts.moderation ?? 0);
}

export function menuButtonLabel(counts: NavCounts): string {
  const total = waitingTotal(counts);
  return total > 0 ? `Open menu, ${total} waiting` : "Open menu";
}

/** The menu is for one screen on a phone: a route change or a wider window ends it. */
export function menuStaysOpen({ open, phone, from, to }: { open: boolean; phone: boolean; from: string; to: string }): boolean {
  return open && phone && from === to;
}
