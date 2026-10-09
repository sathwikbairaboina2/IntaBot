import type { AccountView, ClassificationView } from "./api";
import { formatSlot } from "./format";

export type Tone = "ok" | "warn" | "danger" | "info" | "accent" | "neutral";

export interface Expiry {
  level: "ok" | "soon" | "expired" | "unknown";
  label: string;
}

export interface AccountStats {
  total: number;
  active: number;
  degraded: number;
  dryRun: number;
  tokensDue: number;
}

const DAY_MS = 86_400_000;
const SOON_DAYS = 14;

function utcDay(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

function isValid(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

export function tokenExpiry(iso: string, now: Date): Expiry {
  const at = new Date(iso);
  if (!isValid(at)) return { level: "unknown", label: "unknown" };
  if (at.getTime() <= now.getTime()) {
    const ago = utcDay(now) - utcDay(at);
    if (ago === 0) return { level: "expired", label: "expired today" };
    if (ago === 1) return { level: "expired", label: "expired yesterday" };
    return { level: "expired", label: `expired ${ago} days ago` };
  }
  const days = utcDay(at) - utcDay(now);
  if (days === 0) return { level: "soon", label: "expires today" };
  return { level: days <= SOON_DAYS ? "soon" : "ok", label: days === 1 ? "in 1 day" : `in ${days} days` };
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return isValid(date) ? DATE.format(date) : "—";
}

export function slotLabel(iso: string): string {
  return isValid(new Date(iso)) ? `${formatSlot(iso, "UTC")} UTC` : "No slot yet";
}

export function accountStatus(status: AccountView["status"]): { label: string; tone: Tone } {
  switch (status) {
    case "ACTIVE":
      return { label: "Active", tone: "ok" };
    case "DEGRADED":
      return { label: "Degraded", tone: "warn" };
    case "DISABLED":
      return { label: "Disabled", tone: "danger" };
    default:
      return { label: String(status), tone: "neutral" };
  }
}

export function accountStats(accounts: AccountView[], now: Date): AccountStats {
  return {
    total: accounts.length,
    active: accounts.filter((a) => a.status === "ACTIVE").length,
    degraded: accounts.filter((a) => a.status === "DEGRADED").length,
    dryRun: accounts.filter((a) => a.dryRun).length,
    tokensDue: accounts.filter((a) => {
      const level = tokenExpiry(a.tokenExpiresAt, now).level;
      return level === "soon" || level === "expired";
    }).length,
  };
}

const INTENT_TONES: Partial<Record<ClassificationView["intent"], Tone>> = {
  question: "info",
  praise: "ok",
  complaint: "warn",
};

export function intentTone(intent: ClassificationView["intent"]): Tone {
  return INTENT_TONES[intent] ?? "neutral";
}

export function sentimentTone(sentiment: ClassificationView["sentiment"]): Tone {
  if (sentiment === "positive") return "ok";
  if (sentiment === "negative") return "danger";
  return "neutral";
}

/** Same split as approvePost, so the counter matches what gets saved. */
export function hashtagCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileKind(mime: string): string {
  return mime.split("/")[1]?.toUpperCase() || "FILE";
}

export const ACCEPTED_MEDIA = ["image/jpeg", "image/png", "image/webp", "video/mp4"];

export function isAcceptedMedia(mime: string): boolean {
  return ACCEPTED_MEDIA.includes(mime);
}

export function relativeTime(iso: string, now: Date): string {
  const at = new Date(iso);
  if (!isValid(at)) return "";
  const seconds = Math.floor((now.getTime() - at.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function initials(handle: string): string {
  const parts = handle.replace(/^@/, "").split(/[._\-\s]+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const second = parts[1];
  return (second ? `${first.charAt(0)}${second.charAt(0)}` : first.slice(0, 2)).toUpperCase();
}
