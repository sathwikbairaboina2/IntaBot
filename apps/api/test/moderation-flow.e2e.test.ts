import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { AuditRepository } from "../src/audit/audit.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { ModerationProcessor, type ModerationJobData } from "../src/jobs/moderation.processor";
import { FakeCommentClassifier } from "../src/moderation/fake-comment-classifier";
import { FakeReplyWriter } from "../src/moderation/fake-reply-writer";
import { CommentRepository } from "../src/moderation/comment.repository";
import { IgMediaRefRepository } from "../src/moderation/ig-media-ref.repository";
import { ReplyCapService } from "../src/moderation/reply-cap.service";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

describe("moderation flow", () => {
  let app: INestApplication;
  let accountId: string;
  let postId: string;
  const igMediaId = "ig-media-77";

  function job(over: Partial<ModerationJobData> = {}): ModerationJobData {
    return {
      accountId,
      igCommentId: "c-1",
      igMediaId,
      fromIgUserId: "9900112",
      fromUsername: "happyfan",
      text: "Love this!",
      ...over,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    app.get(FakeInstagramAdapter).reset();
    app.get(FakeCommentClassifier).reset();
    app.get(FakeReplyWriter).reset();

    const account = await app.get(AccountRepository).create({
      name: "Studio Nord",
      igUserId: "1784140",
      username: "studionord",
      accessTokenEncrypted: "v1:a:b:c",
      tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    await app.get(AccountRepository).update(accountId, { dryRun: false });

    const post = await app.get(PostRepository).create({
      accountId,
      format: "IMAGE",
      mediaAssetIds: ["a1"],
      caption: "New print run.",
      hashtags: [],
      scheduledAt: "2026-08-20T09:00:00.000Z",
    });
    postId = post.id;
    await app.get(IgMediaRefRepository).put(igMediaId, { accountId, postId });
  });

  afterAll(async () => {
    await app.close();
  });

  it("auto-replies to praise, exactly once, with audit and cap", async () => {
    const { outcome } = await app.get(ModerationProcessor).process(job());
    expect(outcome).toBe("replied");

    const comment = await app.get(CommentRepository).get(postId, "c-1");
    expect(comment?.status).toBe("AUTO_REPLIED");
    expect(comment?.replyText).toBeTruthy();
    expect(comment?.replyId).toBeTruthy();
    expect(comment?.classification?.intent).toBe("praise");

    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(1);

    const caps = await app
      .get(ReplyCapService)
      .check(accountId, postId, { replyCapPerPostPerHour: 1, replyCapPerAccountPerHour: 1 });
    expect(caps.postCapReached).toBe(true);

    const audit = await app.get(AuditRepository).list(accountId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: "agent", action: "AUTO_REPLIED", rule: "default" });
  });

  it("replies once even when the same job runs twice", async () => {
    await app.get(ModerationProcessor).process(job());
    const second = await app.get(ModerationProcessor).process(job());
    expect(second.outcome).toBe("duplicate");
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(1);
  });

  it("escalates a complaint without replying", async () => {
    const { outcome } = await app
      .get(ModerationProcessor)
      .process(job({ text: "This arrived broken." }));
    expect(outcome).toBe("escalated");

    const comment = await app.get(CommentRepository).get(postId, "c-1");
    expect(comment?.status).toBe("ESCALATED");
    expect(comment?.policyRule).toBe("needs-human");
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(0);
  });

  it("ignores spam", async () => {
    const { outcome } = await app
      .get(ModerationProcessor)
      .process(job({ text: "win big https://spam.test" }));
    expect(outcome).toBe("ignored");
    expect((await app.get(CommentRepository).get(postId, "c-1"))?.policyRule).toBe("spam");
  });

  it("escalates a blocklisted term before the classification matters", async () => {
    await app.get(AccountRepository).update(accountId, { blocklist: ["giveaway"] });
    const { outcome } = await app
      .get(ModerationProcessor)
      .process(job({ text: "Nice GIVEAWAY idea" }));
    expect(outcome).toBe("escalated");
    expect((await app.get(CommentRepository).get(postId, "c-1"))?.policyRule).toBe("blocklist");
  });

  it("never classifies the account's own comment", async () => {
    const { outcome } = await app
      .get(ModerationProcessor)
      .process(job({ fromIgUserId: "1784140", text: "our own reply" }));
    expect(outcome).toBe("ignored");
    const comment = await app.get(CommentRepository).get(postId, "c-1");
    expect(comment?.policyRule).toBe("self-reply-guard");
    expect(comment?.classification).toBeUndefined();
    expect(app.get(FakeCommentClassifier).getCallCount()).toBe(0);
  });

  it("classifies but never replies while moderation is paused", async () => {
    await app.get(AccountRepository).update(accountId, { moderationPaused: true });
    const { outcome } = await app.get(ModerationProcessor).process(job());
    expect(outcome).toBe("ignored");
    const comment = await app.get(CommentRepository).get(postId, "c-1");
    expect(comment?.policyRule).toBe("paused");
    expect(comment?.classification?.intent).toBe("praise");
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(0);
  });

  it("runs the full pipeline in dry-run without touching the port", async () => {
    await app.get(AccountRepository).update(accountId, { dryRun: true });
    const { outcome } = await app.get(ModerationProcessor).process(job());
    expect(outcome).toBe("replied");

    const comment = await app.get(CommentRepository).get(postId, "c-1");
    expect(comment?.status).toBe("AUTO_REPLIED");
    expect(comment?.replyId).toMatch(/^dryrun-/);
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(0);

    const audit = await app.get(AuditRepository).list(accountId);
    expect(audit[0]).toMatchObject({ dryRun: true });
  });

  it("escalates when the reply writer refuses", async () => {
    app.get(FakeReplyWriter).setNextRefusal("policy");
    const { outcome } = await app.get(ModerationProcessor).process(job());
    expect(outcome).toBe("escalated");
    const comment = await app.get(CommentRepository).get(postId, "c-1");
    expect(comment?.status).toBe("ESCALATED");
    expect(comment?.policyRule).toBe("reply-refused");
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(0);
  });

  it("escalates past the reply cap", async () => {
    await app.get(AccountRepository).update(accountId, { replyCapPerPostPerHour: 1 });
    await app.get(ModerationProcessor).process(job({ igCommentId: "c-first" }));
    const { outcome } = await app.get(ModerationProcessor).process(job({ igCommentId: "c-second" }));
    expect(outcome).toBe("escalated");
    expect((await app.get(CommentRepository).get(postId, "c-second"))?.policyRule).toBe(
      "cap-exceeded",
    );
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(1);
  });

  it("ignores comments on media it did not publish", async () => {
    const { outcome } = await app
      .get(ModerationProcessor)
      .process(job({ igMediaId: "someone-elses-media" }));
    expect(outcome).toBe("unknown-media");
    expect(await app.get(CommentRepository).get(postId, "c-1")).toBeNull();
  });
});
