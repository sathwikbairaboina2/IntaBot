import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { FakeInstagramAdapter } from "../instagram/fake-instagram.adapter";
import { GraphError } from "../instagram/graph-responses";
import { FakeCommentClassifier } from "../moderation/fake-comment-classifier";
import { FakeReplyWriter } from "../moderation/fake-reply-writer";
import {
  MemoryAccounts,
  MemoryAudit,
  MemoryCaps,
  MemoryComments,
  MemoryPosts,
  makeAccount,
} from "../../test/memory-stubs";
import { ModerationProcessor } from "./moderation.processor";

const APPLY_URL = "https://aiiolar.com/jobs?job=acme";

describe("ModerationProcessor failures and DM state", () => {
  let posts: MemoryPosts;
  let comments: MemoryComments;
  let ig: FakeInstagramAdapter;
  let caps: MemoryCaps;
  let audit: MemoryAudit;
  let processor: ModerationProcessor;

  function build(account: Account) {
    posts = new MemoryPosts();
    comments = new MemoryComments();
    ig = new FakeInstagramAdapter();
    caps = new MemoryCaps();
    audit = new MemoryAudit();
    processor = new ModerationProcessor(
      new MemoryAccounts([account]) as never,
      posts as never,
      comments as never,
      { get: async () => ({ accountId: "acct-1", postId: "p-1" }) } as never,
      new FakeCommentClassifier(),
      new FakeReplyWriter(),
      caps as never,
      ig,
      audit as never,
    );
    posts.seed({ id: "p-1", status: "PUBLISHED", applyUrl: APPLY_URL });
  }

  const job = (text: string, id: string, extra: Record<string, unknown> = {}) => ({
    accountId: "acct-1",
    igCommentId: id,
    igMediaId: "m-1",
    fromIgUserId: "u-9",
    fromUsername: "someone",
    text,
    ...extra,
  });

  const refuse = (code: number, message: string) => async () => {
    throw new GraphError(code, message, { status: 400 });
  };

  beforeEach(() => build(makeAccount({ dryRun: false })));

  it("records dmState sent when both the reply and the DM go out", async () => {
    await processor.process(job("link", "c-1"));
    const stored = await comments.get("p-1", "c-1");
    expect(stored).toMatchObject({ dmState: "sent", status: "AUTO_REPLIED" });
    expect(stored?.dmError).toBeUndefined();
  });

  it("records dmState sent with a dryrun id in dry run", async () => {
    build(makeAccount({ dryRun: true }));
    await processor.process(job("link", "c-1"));
    const stored = await comments.get("p-1", "c-1");
    expect(stored?.dmState).toBe("sent");
    expect(stored?.dmId).toMatch(/^dryrun-/);
  });

  it("keeps the reply and records dmState failed with the error when the DM fails", async () => {
    ig.sendPrivateReply = refuse(10, "no permission to message this user");
    const { outcome } = await processor.process(job("link", "c-1"));
    expect(outcome).toBe("replied");
    expect(ig.getReplies()).toHaveLength(1);
    const stored = await comments.get("p-1", "c-1");
    expect(stored).toMatchObject({
      status: "AUTO_REPLIED",
      replyId: ig.getReplies()[0]!.replyId,
      dmState: "failed",
      dmError: "graph 10: no permission to message this user",
    });
    expect(stored?.dmText).toContain(APPLY_URL); // kept so it can be resent
    expect(stored?.dmId).toBeUndefined();
    expect(caps.increments).toBe(1);
    expect(audit.entries[0]).toMatchObject({ action: "comment.link-request" });
  });

  it("escalates with failureReason when the public reply is refused, and sends no DM", async () => {
    ig.replyToComment = refuse(190, "Invalid OAuth access token");
    const { outcome } = await processor.process(job("link", "c-1"));
    expect(outcome).toBe("escalated");
    expect(ig.getDms()).toHaveLength(0);
    const stored = await comments.get("p-1", "c-1");
    expect(stored).toMatchObject({
      status: "ESCALATED",
      policyRule: "reply-failed",
      failureReason: "graph 190: Invalid OAuth access token",
    });
    expect(caps.increments).toBe(0);
    expect(audit.entries[0]).toMatchObject({ action: "ESCALATED", rule: "reply-failed" });
  });

  it("escalates the same way when an ordinary auto-reply is refused", async () => {
    ig.replyToComment = refuse(4, "Application request limit reached");
    const { outcome } = await processor.process(job("is this remote?", "c-1"));
    expect(outcome).toBe("escalated");
    const stored = await comments.get("p-1", "c-1");
    expect(stored).toMatchObject({
      status: "ESCALATED",
      failureReason: "graph 4: Application request limit reached",
    });
  });

  it("skips the DM for a comment older than 7 days and records why", async () => {
    const commentedAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { outcome } = await processor.process(job("link", "c-1", { commentedAt }));
    expect(outcome).toBe("replied");
    expect(ig.getReplies()).toHaveLength(1);
    expect(ig.getDms()).toHaveLength(0);
    const stored = await comments.get("p-1", "c-1");
    expect(stored).toMatchObject({ dmState: "skipped" });
    expect(stored?.dmError).toMatch(/7 days/);
  });

  it("still sends the DM for a comment just inside the 7 days", async () => {
    const commentedAt = new Date(Date.now() - 6.9 * 86_400_000).toISOString();
    await processor.process(job("link", "c-1", { commentedAt }));
    expect(ig.getDms()).toHaveLength(1);
    expect((await comments.get("p-1", "c-1"))?.dmState).toBe("sent");
  });
});
