import { describe, expect, it } from "vitest";
import type { Post } from "@intabot/shared";
import { RETRY_STUCK_AFTER_MS, canRetry, toPostView } from "./post-view";

const NOW = new Date("2026-11-26T12:00:00.000Z");

function post(overrides: Partial<Post>): Post {
  return {
    id: "p-1",
    accountId: "acct-1",
    status: "FAILED",
    format: "IMAGE",
    version: 3,
    mediaAssetIds: ["a-1"],
    caption: "c",
    hashtags: [],
    scheduledAt: "2026-11-26T09:00:00.000Z",
    createdAt: "2026-11-26T08:00:00.000Z",
    updatedAt: "2026-11-26T09:00:00.000Z",
    ...overrides,
  };
}

describe("canRetry", () => {
  it("allows a failed post", () => {
    expect(canRetry(post({ status: "FAILED" }), NOW)).toBe(true);
  });

  it("allows a publishing post idle for more than 15 minutes", () => {
    const old = new Date(NOW.getTime() - RETRY_STUCK_AFTER_MS - 1000).toISOString();
    expect(canRetry(post({ status: "PUBLISHING", updatedAt: old }), NOW)).toBe(true);
  });

  it("refuses a publishing post updated within 15 minutes", () => {
    const recent = new Date(NOW.getTime() - RETRY_STUCK_AFTER_MS + 1000).toISOString();
    expect(canRetry(post({ status: "PUBLISHING", updatedAt: recent }), NOW)).toBe(false);
  });

  it.each(["DRAFT", "PENDING_APPROVAL", "APPROVED", "PUBLISHED", "REJECTED"] as const)(
    "refuses %s",
    (status) => {
      expect(canRetry(post({ status, updatedAt: "2020-01-01T00:00:00.000Z" }), NOW)).toBe(false);
    },
  );
});

describe("toPostView", () => {
  it("carries the lifecycle fields and names failureReason as error", () => {
    const view = toPostView(
      post({
        status: "FAILED",
        format: "CAROUSEL",
        keyword: "ZOHO",
        source: { app: "control-room", ref: "content-1" },
        igMediaId: "m-1",
        permalink: "https://instagram.com/p/x",
        failureReason: "container timeout",
      }),
    );
    expect(view).toMatchObject({
      format: "CAROUSEL",
      keyword: "ZOHO",
      source: { app: "control-room", ref: "content-1" },
      igMediaId: "m-1",
      permalink: "https://instagram.com/p/x",
      error: "container timeout",
      scheduledAt: "2026-11-26T09:00:00.000Z",
      updatedAt: "2026-11-26T09:00:00.000Z",
      version: 3,
    });
  });

  it("has a null error when nothing failed", () => {
    expect(toPostView(post({ status: "PUBLISHED" })).error).toBeNull();
  });
});
