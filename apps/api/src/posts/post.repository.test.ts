import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { PostRepository, PostTransitionConflictError } from "./post.repository";

const repo = new PostRepository(docClient, tableMain);

const input = {
  accountId: "acct-1",
  format: "REEL" as const,
  mediaAssetIds: ["asset-1"],
  caption: "Morning light.",
  hashtags: ["#studio"],
  scheduledAt: "2026-08-15T09:00:00.000Z",
};

describe("PostRepository", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("creates a post as DRAFT at version 1", async () => {
    const post = await repo.create(input);
    expect(post.status).toBe("DRAFT");
    expect(post.version).toBe(1);
  });

  it("stores applyUrl and source and reads them back", async () => {
    const post = await repo.create({
      ...input,
      applyUrl: "https://aiiolar.com/jobs?job=abc",
      source: { app: "iolar-studio", ref: "card-1" },
    });
    const found = await repo.get(post.accountId, post.id);
    expect(found?.applyUrl).toBe("https://aiiolar.com/jobs?job=abc");
    expect(found?.source).toEqual({ app: "iolar-studio", ref: "card-1" });
  });

  it("transitions status and increments version", async () => {
    const post = await repo.create(input);
    const moved = await repo.transition({
      accountId: post.accountId,
      postId: post.id,
      expectedStatus: "DRAFT",
      expectedVersion: 1,
      nextStatus: "PENDING_APPROVAL",
    });
    expect(moved.status).toBe("PENDING_APPROVAL");
    expect(moved.version).toBe(2);
  });

  it("applies a patch during a transition", async () => {
    const post = await repo.create(input);
    const moved = await repo.transition({
      accountId: post.accountId,
      postId: post.id,
      expectedStatus: "DRAFT",
      expectedVersion: 1,
      nextStatus: "PUBLISHING",
      patch: { containerId: "container-42" },
    });
    expect(moved.containerId).toBe("container-42");
  });

  it("rejects a transition from the wrong status", async () => {
    const post = await repo.create(input);
    await expect(
      repo.transition({
        accountId: post.accountId,
        postId: post.id,
        expectedStatus: "APPROVED",
        expectedVersion: 1,
        nextStatus: "PUBLISHING",
      }),
    ).rejects.toBeInstanceOf(PostTransitionConflictError);
  });

  it("rejects a transition with a stale version", async () => {
    const post = await repo.create(input);
    await repo.transition({
      accountId: post.accountId,
      postId: post.id,
      expectedStatus: "DRAFT",
      expectedVersion: 1,
      nextStatus: "PENDING_APPROVAL",
    });
    await expect(
      repo.transition({
        accountId: post.accountId,
        postId: post.id,
        expectedStatus: "PENDING_APPROVAL",
        expectedVersion: 1,
        nextStatus: "APPROVED",
      }),
    ).rejects.toBeInstanceOf(PostTransitionConflictError);
  });

  it("lets only one of two concurrent identical transitions win", async () => {
    const post = await repo.create(input);
    const attempt = () =>
      repo.transition({
        accountId: post.accountId,
        postId: post.id,
        expectedStatus: "DRAFT",
        expectedVersion: 1,
        nextStatus: "PUBLISHING",
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("lists posts by status ordered by scheduledAt", async () => {
    const later = await repo.create({ ...input, scheduledAt: "2026-08-20T09:00:00.000Z" });
    const sooner = await repo.create({ ...input, scheduledAt: "2026-08-16T09:00:00.000Z" });
    for (const p of [later, sooner]) {
      await repo.transition({
        accountId: p.accountId,
        postId: p.id,
        expectedStatus: "DRAFT",
        expectedVersion: 1,
        nextStatus: "PENDING_APPROVAL",
      });
    }
    const queue = await repo.listByStatus("acct-1", "PENDING_APPROVAL");
    expect(queue.map((p) => p.scheduledAt)).toEqual([
      "2026-08-16T09:00:00.000Z",
      "2026-08-20T09:00:00.000Z",
    ]);
  });

  it("removes a post from the old status index after transitioning", async () => {
    const post = await repo.create(input);
    await repo.transition({
      accountId: post.accountId,
      postId: post.id,
      expectedStatus: "DRAFT",
      expectedVersion: 1,
      nextStatus: "PENDING_APPROVAL",
    });
    expect(await repo.listByStatus("acct-1", "DRAFT")).toHaveLength(0);
  });
});
