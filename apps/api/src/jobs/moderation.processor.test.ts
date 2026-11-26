import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { FakeInstagramAdapter } from "../instagram/fake-instagram.adapter";
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
const LIST_TEXT = "This week: Acme backend, Beta data, Gamma QA.";

describe("ModerationProcessor keywords", () => {
  let accounts: MemoryAccounts;
  let posts: MemoryPosts;
  let comments: MemoryComments;
  let ig: FakeInstagramAdapter;
  let classifier: FakeCommentClassifier;
  let caps: MemoryCaps;
  let audit: MemoryAudit;
  let processor: ModerationProcessor;

  function build(account: Account) {
    accounts = new MemoryAccounts([account]);
    posts = new MemoryPosts();
    comments = new MemoryComments();
    ig = new FakeInstagramAdapter();
    classifier = new FakeCommentClassifier();
    caps = new MemoryCaps();
    audit = new MemoryAudit();
    const refs = { get: async () => ({ accountId: "acct-1", postId: "p-1" }) };
    processor = new ModerationProcessor(
      accounts as never,
      posts as never,
      comments as never,
      refs as never,
      classifier,
      new FakeReplyWriter(),
      caps as never,
      ig,
      audit as never,
    );
  }

  const job = (text: string, id: string) => ({
    accountId: "acct-1",
    igCommentId: id,
    igMediaId: "m-1",
    fromIgUserId: "u-9",
    fromUsername: "someone",
    text,
  });

  beforeEach(() => build(makeAccount({ dryRun: false })));

  describe("per-post keyword", () => {
    it("answers the post's keyword as a link request", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHED", applyUrl: APPLY_URL, keyword: "ZOHO" });
      const { outcome } = await processor.process(job("ZOHO please", "c-1"));
      expect(outcome).toBe("replied");
      expect(ig.getReplies()[0]).toMatchObject({ commentId: "c-1", text: "Sent you the link in your DMs." });
      expect(ig.getDms()[0]!.text).toContain(APPLY_URL);
      expect((await comments.get("p-1", "c-1"))?.policyRule).toBe("link-request");
      expect(classifier.getCallCount()).toBe(0);
    });

    it("still answers the account's linkKeyword on that post", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHED", applyUrl: APPLY_URL, keyword: "ZOHO" });
      expect((await processor.process(job("link", "c-1"))).outcome).toBe("replied");
      expect(ig.getDms()).toHaveLength(1);
    });

    it("matches whole words only", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHED", applyUrl: APPLY_URL, keyword: "ZOHO" });
      await processor.process(job("zohoo?", "c-1"));
      expect(ig.getDms()).toHaveLength(0);
      expect(classifier.getCallCount()).toBe(1);
    });

    it("does nothing special without an applyUrl", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHED", keyword: "ZOHO" });
      await processor.process(job("ZOHO", "c-1"));
      expect(ig.getDms()).toHaveLength(0);
      expect(classifier.getCallCount()).toBe(1);
    });
  });

  describe("LIST", () => {
    beforeEach(() => build(makeAccount({ dryRun: false, listText: LIST_TEXT })));

    it("replies publicly and sends listText by DM, on a post without applyUrl", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHED" });
      const { outcome } = await processor.process(job("list pls", "c-1"));
      expect(outcome).toBe("replied");
      expect(ig.getReplies()).toHaveLength(1);
      expect(ig.getReplies()[0]!.text).toBe("Sent you the list in your DMs.");
      expect(ig.getDms()).toHaveLength(1);
      expect(ig.getDms()[0]).toMatchObject({ commentId: "c-1", text: LIST_TEXT });

      const stored = await comments.get("p-1", "c-1");
      expect(stored).toMatchObject({
        status: "AUTO_REPLIED",
        policyRule: "list-request",
        replyText: "Sent you the list in your DMs.",
        dmText: LIST_TEXT,
      });
      expect(stored?.dmId).toBe(ig.getDms()[0]!.messageId);
      expect(caps.increments).toBe(1);
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0]).toMatchObject({ action: "comment.list-request", rule: "list-request" });
      expect(classifier.getCallCount()).toBe(0);
    });

    it("answers the account's own listKeyword", async () => {
      build(makeAccount({ dryRun: false, listText: LIST_TEXT, listKeyword: "JOBS" }));
      posts.seed({ id: "p-1", status: "PUBLISHED" });
      await processor.process(job("list", "c-1"));
      expect(ig.getDms()).toHaveLength(0);
      expect((await processor.process(job("JOBS!", "c-2"))).outcome).toBe("replied");
      expect(ig.getDms()[0]!.text).toBe(LIST_TEXT);
    });

    it("never repeats for a redelivered comment", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHED" });
      await processor.process(job("LIST", "c-1"));
      expect((await processor.process(job("LIST", "c-1"))).outcome).toBe("duplicate");
      expect(ig.getDms()).toHaveLength(1);
    });

    it("dry run: records dryrun ids and calls nothing", async () => {
      build(makeAccount({ dryRun: true, listText: LIST_TEXT }));
      posts.seed({ id: "p-1", status: "PUBLISHED" });
      await processor.process(job("LIST", "c-1"));
      expect(ig.getReplies()).toHaveLength(0);
      expect(ig.getDms()).toHaveLength(0);
      const stored = await comments.get("p-1", "c-1");
      expect(stored?.replyId).toMatch(/^dryrun-/);
      expect(stored?.dmId).toMatch(/^dryrun-/);
      expect(stored?.dmText).toBe(LIST_TEXT);
      expect(audit.entries[0]).toMatchObject({ dryRun: true });
    });

    it("applies the caps and the pause", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHED" });
      caps.postCapReached = true;
      expect((await processor.process(job("LIST", "c-1"))).outcome).toBe("escalated");
      expect((await comments.get("p-1", "c-1"))?.policyRule).toBe("cap-exceeded");

      caps.postCapReached = false;
      build(makeAccount({ dryRun: false, listText: LIST_TEXT, moderationPaused: true }));
      posts.seed({ id: "p-1", status: "PUBLISHED" });
      expect((await processor.process(job("LIST", "c-2"))).outcome).toBe("ignored");
      expect(ig.getDms()).toHaveLength(0);
    });

    it("prefers the post's link request when both words are present", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHED", applyUrl: APPLY_URL });
      await processor.process(job("LINK or LIST", "c-1"));
      expect(ig.getDms()[0]!.text).toContain(APPLY_URL);
    });
  });

  it("LIST goes through the normal path when listText is null", async () => {
    posts.seed({ id: "p-1", status: "PUBLISHED" });
    await processor.process(job("LIST", "c-1"));
    expect(ig.getDms()).toHaveLength(0);
    expect(classifier.getCallCount()).toBe(1);
    expect((await comments.get("p-1", "c-1"))?.policyRule).not.toBe("list-request");
  });

  it("LIST goes through the normal path when listText is blank", async () => {
    build(makeAccount({ dryRun: false, listText: "   " }));
    posts.seed({ id: "p-1", status: "PUBLISHED" });
    await processor.process(job("LIST", "c-1"));
    expect(ig.getDms()).toHaveLength(0);
    expect(classifier.getCallCount()).toBe(1);
  });
});
