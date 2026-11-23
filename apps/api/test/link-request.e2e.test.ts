import { createHmac } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { AuditRepository } from "../src/audit/audit.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { ModerationProcessor, type ModerationJobData } from "../src/jobs/moderation.processor";
import { PublishProcessor } from "../src/jobs/publish.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { CommentRepository } from "../src/moderation/comment.repository";
import { FakeCommentClassifier } from "../src/moderation/fake-comment-classifier";
import { FakeReplyWriter } from "../src/moderation/fake-reply-writer";
import { ReplyCapService } from "../src/moderation/reply-cap.service";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues, testQueue } from "./queue-fixture";

const SECRET = process.env.META_APP_SECRET!;
const APPLY_URL = "https://aiiolar.com/jobs?job=acme-backend";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

describe("keyword DM (link request)", () => {
  let app: INestApplication;
  let accountId: string;

  /** Creates, approves and dry-run publishes a post; returns its ids. */
  async function publishedPost(applyUrl?: string): Promise<{ postId: string; igMediaId: string }> {
    const posts = app.get(PostRepository);
    const asset = await app.get(MediaAssetRepository).create({
      accountId,
      storageKey: `${accountId}/a.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 10,
    });
    const draft = await posts.create({
      accountId,
      format: "IMAGE",
      mediaAssetIds: [asset.id],
      caption: "Backend engineer at Acme.",
      hashtags: ["#hiring"],
      scheduledAt: "2020-01-01T00:00:00.000Z",
      ...(applyUrl ? { applyUrl } : {}),
    });
    const pending = await posts.transition({
      accountId,
      postId: draft.id,
      expectedStatus: "DRAFT",
      expectedVersion: draft.version,
      nextStatus: "PENDING_APPROVAL",
    });
    await posts.transition({
      accountId,
      postId: draft.id,
      expectedStatus: "PENDING_APPROVAL",
      expectedVersion: pending.version,
      nextStatus: "APPROVED",
    });
    await app.get(PublishProcessor).process({ accountId, postId: draft.id });
    const post = await posts.get(accountId, draft.id);
    expect(post?.igMediaId).toMatch(/^dryrun-/);
    return { postId: draft.id, igMediaId: post!.igMediaId! };
  }

  /** Sends a signed comment webhook and returns the job it enqueued. */
  async function commentViaWebhook(
    igMediaId: string,
    text: string,
    commentId: string,
  ): Promise<ModerationJobData> {
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "1784140",
          changes: [
            {
              field: "comments",
              value: {
                id: commentId,
                media: { id: igMediaId },
                from: { id: "990", username: "jobseeker" },
                text,
              },
            },
          ],
        },
      ],
    });
    await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body)
      .expect(200);

    const q = testQueue(QUEUE.moderation);
    const waiting = await q.getWaiting();
    const job = waiting.find((j) => j.data.igCommentId === commentId);
    await q.close();
    expect(job).toBeDefined();
    return job!.data as ModerationJobData;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.moderation, QUEUE.publish, QUEUE.pollContainer]);
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
    await app.get(AccountRepository).update(accountId, { dryRun: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it("dry run: webhook to AUTO_REPLIED with dryrun reply and DM, no port calls", async () => {
    const { postId, igMediaId } = await publishedPost(APPLY_URL);
    const job = await commentViaWebhook(igMediaId, "LINK please", "c-1");

    const { outcome } = await app.get(ModerationProcessor).process(job);
    expect(outcome).toBe("replied");

    const comment = await app.get(CommentRepository).get(postId, "c-1");
    expect(comment).toMatchObject({
      status: "AUTO_REPLIED",
      policyRule: "link-request",
      replyText: "Sent you the link in your DMs.",
      dmText: `Here is the apply link: ${APPLY_URL}`,
    });
    expect(comment?.replyId).toMatch(/^dryrun-/);
    expect(comment?.dmId).toMatch(/^dryrun-/);
    expect(app.get(FakeCommentClassifier).getCallCount()).toBe(0);
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(0);
    expect(app.get(FakeInstagramAdapter).getDms()).toHaveLength(0);

    const audit = await app.get(AuditRepository).list(accountId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: "agent",
      action: "comment.link-request",
      rule: "link-request",
      dryRun: true,
    });

    // The DM counts against the reply cap, once.
    const caps = await app
      .get(ReplyCapService)
      .check(accountId, postId, { replyCapPerPostPerHour: 1, replyCapPerAccountPerHour: 2 });
    expect(caps.postCapReached).toBe(true);
    expect(caps.accountCapReached).toBe(false);
  });

  it("live mode (fake adapter): records one public reply and one DM with the URL", async () => {
    const { postId, igMediaId } = await publishedPost(APPLY_URL);
    await app.get(AccountRepository).update(accountId, { dryRun: false });
    const job = await commentViaWebhook(igMediaId, "link", "c-2");

    const { outcome } = await app.get(ModerationProcessor).process(job);
    expect(outcome).toBe("replied");

    const ig = app.get(FakeInstagramAdapter);
    expect(ig.getReplies()).toHaveLength(1);
    expect(ig.getReplies()[0]).toMatchObject({
      commentId: "c-2",
      text: "Sent you the link in your DMs.",
    });
    expect(ig.getDms()).toHaveLength(1);
    expect(ig.getDms()[0]!.commentId).toBe("c-2");
    expect(ig.getDms()[0]!.text).toContain(APPLY_URL);

    const comment = await app.get(CommentRepository).get(postId, "c-2");
    expect(comment?.replyId).toBe(ig.getReplies()[0]!.replyId);
    expect(comment?.dmId).toBe(ig.getDms()[0]!.messageId);
    expect(comment?.status).toBe("AUTO_REPLIED");

    // A redelivered job does nothing more.
    expect((await app.get(ModerationProcessor).process(job)).outcome).toBe("duplicate");
    expect(ig.getDms()).toHaveLength(1);
  });

  it("uses the account's own keyword", async () => {
    const { postId, igMediaId } = await publishedPost(APPLY_URL);
    await app.get(AccountRepository).update(accountId, { linkKeyword: "APPLY" });
    const miss = await commentViaWebhook(igMediaId, "link", "c-a");
    await app.get(ModerationProcessor).process(miss);
    expect((await app.get(CommentRepository).get(postId, "c-a"))?.policyRule).not.toBe(
      "link-request",
    );
    const hit = await commentViaWebhook(igMediaId, "Apply!", "c-b");
    expect((await app.get(ModerationProcessor).process(hit)).outcome).toBe("replied");
    expect((await app.get(CommentRepository).get(postId, "c-b"))?.policyRule).toBe("link-request");
  });

  it("sends a linkedin comment through the classifier", async () => {
    const { postId, igMediaId } = await publishedPost(APPLY_URL);
    const job = await commentViaWebhook(igMediaId, "linkedin?", "c-3");
    await app.get(ModerationProcessor).process(job);

    const comment = await app.get(CommentRepository).get(postId, "c-3");
    expect(comment?.policyRule).not.toBe("link-request");
    expect(comment?.dmId).toBeUndefined();
    expect(app.get(FakeCommentClassifier).getCallCount()).toBe(1);
    expect(app.get(FakeInstagramAdapter).getDms()).toHaveLength(0);
  });

  it("treats LINK on a post without applyUrl as a normal comment", async () => {
    const { postId, igMediaId } = await publishedPost();
    const job = await commentViaWebhook(igMediaId, "LINK please", "c-4");
    await app.get(ModerationProcessor).process(job);

    const comment = await app.get(CommentRepository).get(postId, "c-4");
    expect(comment?.policyRule).not.toBe("link-request");
    expect(comment?.dmText).toBeUndefined();
    expect(app.get(FakeCommentClassifier).getCallCount()).toBe(1);
  });

  it("ignores a link request while moderation is paused", async () => {
    const { postId, igMediaId } = await publishedPost(APPLY_URL);
    await app.get(AccountRepository).update(accountId, { moderationPaused: true, dryRun: false });
    const job = await commentViaWebhook(igMediaId, "LINK", "c-5");

    const { outcome } = await app.get(ModerationProcessor).process(job);
    expect(outcome).toBe("ignored");
    const comment = await app.get(CommentRepository).get(postId, "c-5");
    expect(comment).toMatchObject({ status: "IGNORED", policyRule: "paused" });
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(0);
    expect(app.get(FakeInstagramAdapter).getDms()).toHaveLength(0);
  });

  it("escalates a link request past the reply cap", async () => {
    const { postId, igMediaId } = await publishedPost(APPLY_URL);
    await app.get(AccountRepository).update(accountId, { replyCapPerPostPerHour: 1 });
    await app.get(ModerationProcessor).process(await commentViaWebhook(igMediaId, "LINK", "c-6"));
    const { outcome } = await app
      .get(ModerationProcessor)
      .process(await commentViaWebhook(igMediaId, "LINK", "c-7"));
    expect(outcome).toBe("escalated");
    expect((await app.get(CommentRepository).get(postId, "c-7"))?.policyRule).toBe("cap-exceeded");
  });

  it("never answers the account's own link comment", async () => {
    const { postId, igMediaId } = await publishedPost(APPLY_URL);
    const job = await commentViaWebhook(igMediaId, "LINK", "c-8");
    const { outcome } = await app
      .get(ModerationProcessor)
      .process({ ...job, fromIgUserId: "1784140" });
    expect(outcome).toBe("ignored");
    expect((await app.get(CommentRepository).get(postId, "c-8"))?.policyRule).toBe(
      "self-reply-guard",
    );
  });
});
