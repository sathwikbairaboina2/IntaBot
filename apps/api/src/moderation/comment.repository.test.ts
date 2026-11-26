import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { CommentRepository, CommentTransitionConflictError } from "./comment.repository";
import { IgMediaRefRepository } from "./ig-media-ref.repository";

const repo = new CommentRepository(docClient, tableMain);
const refs = new IgMediaRefRepository(docClient, tableMain);

const input = {
  igCommentId: "1790001",
  accountId: "acct-1",
  postId: "post-1",
  igMediaId: "fake-media-9",
  text: "Love this!",
  fromIgUserId: "9900112",
  fromUsername: "happyfan",
};

describe("CommentRepository", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("creates a comment as RECEIVED at version 1", async () => {
    const comment = await repo.create(input);
    expect(comment?.status).toBe("RECEIVED");
    expect(comment?.version).toBe(1);
    expect(await repo.get(input.postId, input.igCommentId)).toMatchObject({
      text: "Love this!",
      fromUsername: "happyfan",
    });
  });

  it("returns null for a duplicate create", async () => {
    await repo.create(input);
    expect(await repo.create(input)).toBeNull();
  });

  it("transitions status, bumps version, stores the patch", async () => {
    const created = await repo.create(input);
    const moved = await repo.transition({
      postId: input.postId,
      igCommentId: input.igCommentId,
      accountId: input.accountId,
      expectedStatus: "RECEIVED",
      expectedVersion: created!.version,
      nextStatus: "ESCALATED",
      patch: {
        policyRule: "needs-human",
        classification: {
          sentiment: "negative",
          intent: "complaint",
          toxicity: 0.4,
          isSpam: false,
          needsHuman: true,
        },
      },
    });
    expect(moved.status).toBe("ESCALATED");
    expect(moved.version).toBe(2);
    expect(moved.policyRule).toBe("needs-human");
    expect(moved.classification?.intent).toBe("complaint");
  });

  it("throws CommentTransitionConflictError on a stale version", async () => {
    const created = await repo.create(input);
    await repo.transition({
      postId: input.postId,
      igCommentId: input.igCommentId,
      accountId: input.accountId,
      expectedStatus: "RECEIVED",
      expectedVersion: created!.version,
      nextStatus: "IGNORED",
    });
    await expect(
      repo.transition({
        postId: input.postId,
        igCommentId: input.igCommentId,
        accountId: input.accountId,
        expectedStatus: "RECEIVED",
        expectedVersion: created!.version,
        nextStatus: "ESCALATED",
      }),
    ).rejects.toBeInstanceOf(CommentTransitionConflictError);
  });

  it("lists by status: escalated oldest-first, auto-replied newest-first with a limit", async () => {
    for (const [i, id] of ["c1", "c2", "c3"].entries()) {
      const created = await repo.create({
        ...input,
        igCommentId: id,
        postId: `post-${i}`,
      });
      await repo.transition({
        postId: `post-${i}`,
        igCommentId: id,
        accountId: input.accountId,
        expectedStatus: "RECEIVED",
        expectedVersion: created!.version,
        nextStatus: i === 0 ? "ESCALATED" : "AUTO_REPLIED",
      });
    }

    const escalated = await repo.listByStatus(input.accountId, "ESCALATED");
    expect(escalated.map((c) => c.igCommentId)).toEqual(["c1"]);

    const auto = await repo.listByStatus(input.accountId, "AUTO_REPLIED", {
      newestFirst: true,
      limit: 1,
    });
    expect(auto).toHaveLength(1);
    expect(auto[0]!.igCommentId).toBe("c3");
  });
});

describe("IgMediaRefRepository", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("stores and resolves an ig media id", async () => {
    await refs.put("ig-777", { accountId: "acct-1", postId: "post-1" });
    expect(await refs.get("ig-777")).toEqual({ accountId: "acct-1", postId: "post-1" });
  });

  it("returns null for unknown media and overwrites idempotently", async () => {
    expect(await refs.get("nope")).toBeNull();
    await refs.put("ig-777", { accountId: "acct-1", postId: "post-1" });
    await refs.put("ig-777", { accountId: "acct-1", postId: "post-1" });
    expect(await refs.get("ig-777")).toEqual({ accountId: "acct-1", postId: "post-1" });
  });
});

describe("CommentRepository listing for the panel", () => {
  beforeEach(async () => {
    await resetTables();
  });

  async function seed() {
    // createdAt comes from the clock, so a short pause keeps the order stable.
    for (const [id, postId] of [
      ["c1", "post-1"],
      ["c2", "post-1"],
      ["c3", "post-2"],
    ] as const) {
      await repo.create({ ...input, igCommentId: id, postId });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it("lists the comments of one post, oldest first", async () => {
    await seed();
    const found = await repo.listByPost("post-1");
    expect(found.map((c) => c.igCommentId)).toEqual(["c1", "c2"]);
  });

  it("pages an account's comments newest first across posts and statuses", async () => {
    await seed();
    const c2 = await repo.get("post-1", "c2");
    await repo.transition({
      postId: "post-1",
      igCommentId: "c2",
      accountId: "acct-1",
      expectedStatus: "RECEIVED",
      expectedVersion: c2!.version,
      nextStatus: "ESCALATED",
    });

    const first = await repo.listRecent("acct-1", { limit: 2 });
    expect(first.items.map((c) => c.igCommentId)).toEqual(["c3", "c2"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await repo.listRecent("acct-1", { limit: 2, before: first.nextCursor! });
    expect(second.items.map((c) => c.igCommentId)).toEqual(["c1"]);
    expect(second.nextCursor).toBeNull();

    const escalated = await repo.listRecent("acct-1", { limit: 10, status: "ESCALATED" });
    expect(escalated.items.map((c) => c.igCommentId)).toEqual(["c2"]);
    const since = await repo.listRecent("acct-1", { limit: 10, since: c2!.createdAt });
    expect(since.items.map((c) => c.igCommentId)).toEqual(["c3", "c2"]);
  });
});
