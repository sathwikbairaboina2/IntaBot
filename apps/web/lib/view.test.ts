import { describe, expect, it } from "vitest";
import type { AccountView } from "./api";
import {
  accountStats,
  accountStatus,
  fileKind,
  formatBytes,
  formatDate,
  hashtagCount,
  initials,
  intentTone,
  isAcceptedMedia,
  relativeTime,
  sentimentTone,
  slotLabel,
  tokenExpiry,
} from "./view";

const NOW = new Date("2026-10-09T10:00:00.000Z");

function account(overrides: Partial<AccountView>): AccountView {
  return {
    id: "a1",
    name: "Iolar Tech",
    igUserId: "1",
    username: "iolar.tech",
    status: "ACTIVE",
    dryRun: true,
    moderationPaused: false,
    tokenExpiresAt: "2026-12-14T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("tokenExpiry", () => {
  it("is ok beyond 14 days", () => {
    expect(tokenExpiry("2026-12-14T00:00:00.000Z", NOW)).toEqual({ level: "ok", label: "in 66 days" });
  });

  it("is soon within 14 days", () => {
    expect(tokenExpiry("2026-10-21T00:00:00.000Z", NOW)).toEqual({ level: "soon", label: "in 12 days" });
    expect(tokenExpiry("2026-10-23T23:00:00.000Z", NOW)).toEqual({ level: "soon", label: "in 14 days" });
    expect(tokenExpiry("2026-10-10T08:00:00.000Z", NOW)).toEqual({ level: "soon", label: "in 1 day" });
  });

  it("says today when it expires later today", () => {
    expect(tokenExpiry("2026-10-09T18:00:00.000Z", NOW)).toEqual({ level: "soon", label: "expires today" });
  });

  it("is expired once the instant has passed", () => {
    expect(tokenExpiry("2026-10-09T09:00:00.000Z", NOW)).toEqual({ level: "expired", label: "expired today" });
    expect(tokenExpiry("2026-10-08T12:00:00.000Z", NOW)).toEqual({ level: "expired", label: "expired yesterday" });
    expect(tokenExpiry("2026-10-02T00:00:00.000Z", NOW)).toEqual({ level: "expired", label: "expired 7 days ago" });
  });

  it("does not crash on a bad date", () => {
    expect(tokenExpiry("not a date", NOW)).toEqual({ level: "unknown", label: "unknown" });
  });
});

describe("formatDate", () => {
  it("formats in en-GB, UTC", () => {
    expect(formatDate("2026-12-14T23:30:00.000Z")).toBe("14 Dec 2026");
  });

  it("returns an em dash for a bad date", () => {
    expect(formatDate("")).toBe("—");
  });
});

describe("slotLabel", () => {
  it("labels the slot as UTC", () => {
    expect(slotLabel("2026-08-20T09:00:00.000Z")).toBe("20 Aug 2026, 09:00 UTC");
  });

  it("does not crash on a bad slot", () => {
    expect(slotLabel("nope")).toBe("No slot yet");
  });
});

describe("accountStatus", () => {
  it("maps the three API states", () => {
    expect(accountStatus("ACTIVE")).toEqual({ label: "Active", tone: "ok" });
    expect(accountStatus("DEGRADED")).toEqual({ label: "Degraded", tone: "warn" });
    expect(accountStatus("DISABLED")).toEqual({ label: "Disabled", tone: "danger" });
  });

  it("shows an unknown state as-is", () => {
    expect(accountStatus("PAUSED" as AccountView["status"])).toEqual({ label: "PAUSED", tone: "neutral" });
  });
});

describe("accountStats", () => {
  it("counts totals, active, degraded, dry run and tokens due", () => {
    const accounts = [
      account({ id: "1" }),
      account({ id: "2", dryRun: false, moderationPaused: true, tokenExpiresAt: "2026-10-21T00:00:00.000Z" }),
      account({ id: "3", status: "DEGRADED", tokenExpiresAt: "2026-10-02T00:00:00.000Z" }),
      account({ id: "4", status: "DISABLED", dryRun: false }),
    ];
    expect(accountStats(accounts, NOW)).toEqual({ total: 4, active: 2, degraded: 1, dryRun: 2, tokensDue: 2 });
  });

  it("is all zeros for no accounts", () => {
    expect(accountStats([], NOW)).toEqual({ total: 0, active: 0, degraded: 0, dryRun: 0, tokensDue: 0 });
  });
});

describe("tones", () => {
  it("maps intents", () => {
    expect(intentTone("question")).toBe("info");
    expect(intentTone("praise")).toBe("ok");
    expect(intentTone("complaint")).toBe("warn");
    expect(intentTone("spam")).toBe("neutral");
    expect(intentTone("other")).toBe("neutral");
  });

  it("maps sentiments", () => {
    expect(sentimentTone("positive")).toBe("ok");
    expect(sentimentTone("neutral")).toBe("neutral");
    expect(sentimentTone("negative")).toBe("danger");
  });
});

describe("hashtagCount", () => {
  it("counts whitespace-separated tags the way the approve action splits them", () => {
    expect(hashtagCount("#a #b  #c")).toBe(3);
    expect(hashtagCount("  ")).toBe(0);
    expect(hashtagCount("#a\n#b")).toBe(2);
  });
});

describe("files", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(839_680)).toBe("820 KB");
    expect(formatBytes(19_293_798)).toBe("18.4 MB");
  });

  it("names the file kind from its MIME type", () => {
    expect(fileKind("video/mp4")).toBe("MP4");
    expect(fileKind("image/jpeg")).toBe("JPEG");
    expect(fileKind("")).toBe("FILE");
  });

  it("accepts only the media the API takes", () => {
    for (const ok of ["image/jpeg", "image/png", "image/webp", "video/mp4"]) expect(isAcceptedMedia(ok)).toBe(true);
    for (const bad of ["image/gif", "video/quicktime", "application/pdf", ""]) expect(isAcceptedMedia(bad)).toBe(false);
  });
});

describe("relativeTime", () => {
  it("rounds down to the largest unit", () => {
    expect(relativeTime("2026-10-09T09:59:30.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-10-09T09:48:00.000Z", NOW)).toBe("12 min ago");
    expect(relativeTime("2026-10-09T07:00:00.000Z", NOW)).toBe("3 h ago");
    expect(relativeTime("2026-10-07T09:00:00.000Z", NOW)).toBe("2 d ago");
  });

  it("treats future times as just now and bad dates as empty", () => {
    expect(relativeTime("2026-10-09T10:05:00.000Z", NOW)).toBe("just now");
    expect(relativeTime("bad", NOW)).toBe("");
  });
});

describe("initials", () => {
  it("takes the first letters of the handle's parts", () => {
    expect(initials("dev.sana")).toBe("DS");
    expect(initials("@k_arjun")).toBe("KA");
    expect(initials("mrohit")).toBe("MR");
    expect(initials("")).toBe("?");
  });
});
