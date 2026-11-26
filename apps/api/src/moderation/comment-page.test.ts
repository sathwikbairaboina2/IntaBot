import { describe, expect, it } from "vitest";
import type { Comment } from "@intabot/shared";
import { pageComments } from "./comment-page";

function comment(id: string, createdAt: string): Comment {
  return {
    igCommentId: id,
    accountId: "acct-1",
    postId: "p-1",
    igMediaId: "m-1",
    text: id,
    fromIgUserId: "u",
    fromUsername: "someone",
    status: "RECEIVED",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

const all = [
  comment("c1", "2026-11-26T10:00:00.000Z"),
  comment("c3", "2026-11-26T12:00:00.000Z"),
  comment("c2", "2026-11-26T11:00:00.000Z"),
  comment("c4", "2026-11-26T13:00:00.000Z"),
];

describe("pageComments", () => {
  it("returns newest first and a cursor while more remain", () => {
    const page = pageComments(all, { limit: 2 });
    expect(page.items.map((c) => c.igCommentId)).toEqual(["c4", "c3"]);
    expect(page.nextCursor).toBe("2026-11-26T12:00:00.000Z");
  });

  it("continues strictly before the cursor and ends with a null cursor", () => {
    const page = pageComments(all, { limit: 2, before: "2026-11-26T12:00:00.000Z" });
    expect(page.items.map((c) => c.igCommentId)).toEqual(["c2", "c1"]);
    expect(page.nextCursor).toBeNull();
  });

  it("filters by since, inclusive", () => {
    const page = pageComments(all, { limit: 10, since: "2026-11-26T11:00:00.000Z" });
    expect(page.items.map((c) => c.igCommentId)).toEqual(["c4", "c3", "c2"]);
    expect(page.nextCursor).toBeNull();
  });
});
