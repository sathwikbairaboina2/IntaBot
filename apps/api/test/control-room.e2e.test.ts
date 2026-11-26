// HTTP-level checks for the control-room endpoints: panel guard (handoff key or
// session), comments, carousel/reel handoff, retry, approvals and /posts.
// Needs DynamoDB Local and Redis like the other e2e suites.
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { AuditRepository } from "../src/audit/audit.repository";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { ModerationProcessor } from "../src/jobs/moderation.processor";
import { PollContainerProcessor } from "../src/jobs/poll-container.processor";
import { PublishProcessor } from "../src/jobs/publish.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { CommentRepository } from "../src/moderation/comment.repository";
import { FakeCommentClassifier } from "../src/moderation/fake-comment-classifier";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues, testQueue } from "./queue-fixture";

const KEY = "panel-test-key";
const APPLY_URL = "https://aiiolar.com/jobs?job=acme";
const LIST_TEXT = "This week: Acme backend, Beta data.";
// A 1x1 PNG: enough for the content-type check, which is by mimetype.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("control room endpoints", () => {
  let app: INestApplication;
  let accountId: string;
  let cookie: string;

  const http = () => request(app.getHttpServer());
  const withKey = <T extends request.Test>(req: T) => req.set("x-handoff-key", KEY);
  const withSession = <T extends request.Test>(req: T) => req.set("Cookie", cookie);

  async function makePost(
    overrides: { applyUrl?: string; keyword?: string; format?: "IMAGE" | "CAROUSEL" | "REEL"; assets?: number } = {},
  ) {
    const posts = app.get(PostRepository);
    const assetIds: string[] = [];
    for (let i = 0; i < (overrides.assets ?? 1); i++) {
      const asset = await app.get(MediaAssetRepository).create({
        accountId,
        storageKey: `${accountId}/a${i}.png`,
        contentType: "image/png",
        sizeBytes: 10,
      });
      assetIds.push(asset.id);
    }
    const draft = await posts.create({
      accountId,
      format: overrides.format ?? "IMAGE",
      mediaAssetIds: assetIds,
      caption: "Backend engineer at Acme.",
      hashtags: ["#hiring"],
      scheduledAt: "2020-01-01T00:00:00.000Z",
      ...(overrides.applyUrl ? { applyUrl: overrides.applyUrl } : {}),
      ...(overrides.keyword ? { keyword: overrides.keyword } : {}),
    });
    const pending = await posts.transition({
      accountId,
      postId: draft.id,
      expectedStatus: "DRAFT",
      expectedVersion: draft.version,
      nextStatus: "PENDING_APPROVAL",
    });
    return pending;
  }

  /** Approves and runs the publisher; with the account in dry run this ends PUBLISHED. */
  async function publishedPost(overrides: Parameters<typeof makePost>[0] = {}) {
    const posts = app.get(PostRepository);
    const pending = await makePost(overrides);
    await posts.transition({
      accountId,
      postId: pending.id,
      expectedStatus: "PENDING_APPROVAL",
      expectedVersion: pending.version,
      nextStatus: "APPROVED",
    });
    await app.get(PublishProcessor).process({ accountId, postId: pending.id });
    const post = await posts.get(accountId, pending.id);
    return { postId: pending.id, igMediaId: post!.igMediaId! };
  }

  function comment(igMediaId: string, text: string, id: string) {
    return {
      accountId,
      igCommentId: id,
      igMediaId,
      fromIgUserId: "990",
      fromUsername: "jobseeker",
      text,
    };
  }

  beforeAll(async () => {
    process.env.HANDOFF_KEY = KEY;
    delete process.env.HANDOFF_ACCOUNT_ID;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.pollContainer, QUEUE.publish]);
    app.get(FakeInstagramAdapter).reset();
    app.get(FakeCommentClassifier).reset();
    accountId = (
      await app.get(AccountRepository).create({
        name: "Studio Nord",
        igUserId: "1784140",
        username: "studionord",
        accessTokenEncrypted: "v1:a:b:c",
        tokenExpiresAt: "2026-10-13T00:00:00.000Z",
      })
    ).id;
    await app.get(UserRepository).create("op@example.com", await app.get(PasswordService).hash("pw"));
    const login = await http().post("/auth/login").send({ email: "op@example.com", password: "pw" });
    cookie = login.headers["set-cookie"]!;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.HANDOFF_KEY;
    await testQueue(QUEUE.pollContainer).close();
  });

  describe("panel guard", () => {
    const routes: Array<[string, string]> = [
      ["get", "/comments?accountId=x"],
      ["get", "/posts/p-1/comments"],
      ["get", "/posts?accountId=x&status=APPROVED"],
      ["get", "/posts/p-1"],
      ["post", "/posts/p-1/retry"],
      ["post", "/comments/c-1/reply"],
      ["post", "/comments/c-1/hide"],
      ["post", "/comments/c-1/dm"],
      ["delete", "/comments/c-1"],
      ["post", "/approvals/p-1/approve"],
      ["post", "/approvals/p-1/reject"],
    ];

    it.each(routes)("%s %s answers 401 without a key or session", async (method, path) => {
      await (http() as unknown as Record<string, (p: string) => request.Test>)[method]!(path).expect(401);
    });

    it.each(routes)("%s %s answers 401 for a wrong key", async (method, path) => {
      await (http() as unknown as Record<string, (p: string) => request.Test>)
        [method]!(path)
        .set("x-handoff-key", "nope")
        .expect(401);
    });

    it("lets the key and the session through to the same endpoint", async () => {
      await withKey(http().get(`/comments?accountId=${accountId}`)).expect(200);
      await withSession(http().get(`/comments?accountId=${accountId}`)).expect(200);
    });
  });

  describe("per-post keyword and LIST", () => {
    it("answers the post keyword and the account keyword with the link, after a keyword handoff", async () => {
      const card = JSON.stringify({ contentId: "c-kw", title: "One role", applyUrl: APPLY_URL, keyword: "ZOHO" });
      const created = await withKey(
        http().post("/handoff/reel").field("card", card).attach("file", Buffer.alloc(100, 1), {
          filename: "r.mp4",
          contentType: "video/mp4",
        }),
      ).expect(201);
      expect(created.body.caption).toContain("Comment ZOHO and we'll DM you the link.");
      const stored = await app.get(PostRepository).get(accountId, created.body.postId);
      expect(stored?.keyword).toBe("ZOHO");

      const { postId, igMediaId } = await publishedPost({ applyUrl: APPLY_URL, keyword: "ZOHO" });
      await app.get(AccountRepository).update(accountId, { dryRun: false });
      const ig = app.get(FakeInstagramAdapter);
      await app.get(ModerationProcessor).process(comment(igMediaId, "ZOHO please", "c-1"));
      await app.get(ModerationProcessor).process(comment(igMediaId, "link", "c-2"));
      expect(ig.getDms().map((d) => d.commentId)).toEqual(["c-1", "c-2"]);
      expect(ig.getDms()[0]!.text).toContain(APPLY_URL);
      expect((await app.get(CommentRepository).get(postId, "c-1"))?.policyRule).toBe("link-request");
    });

    it("LIST with listText replies and DMs it, dry run included", async () => {
      const { postId, igMediaId } = await publishedPost();
      await app.get(AccountRepository).update(accountId, { listText: LIST_TEXT });
      await app.get(ModerationProcessor).process(comment(igMediaId, "LIST", "c-dry"));
      const dry = await app.get(CommentRepository).get(postId, "c-dry");
      expect(dry).toMatchObject({ policyRule: "list-request", dmText: LIST_TEXT });
      expect(dry?.dmId).toMatch(/^dryrun-/);
      expect(app.get(FakeInstagramAdapter).getDms()).toHaveLength(0);

      await app.get(AccountRepository).update(accountId, { dryRun: false });
      await app.get(ModerationProcessor).process(comment(igMediaId, "list pls", "c-live"));
      const ig = app.get(FakeInstagramAdapter);
      expect(ig.getReplies()[0]!.text).toBe("Sent you the list in your DMs.");
      expect(ig.getDms()[0]).toMatchObject({ commentId: "c-live", text: LIST_TEXT });
      const entries = await app.get(AuditRepository).list(accountId);
      expect(entries.map((e) => e.action)).toContain("comment.list-request");
    });

    it("LIST without listText goes through the normal path", async () => {
      const { postId, igMediaId } = await publishedPost();
      await app.get(ModerationProcessor).process(comment(igMediaId, "LIST", "c-1"));
      expect((await app.get(CommentRepository).get(postId, "c-1"))?.policyRule).not.toBe("list-request");
      expect(app.get(FakeCommentClassifier).getCallCount()).toBe(1);
    });
  });

  describe("comment endpoints", () => {
    async function seedComment() {
      const { postId, igMediaId } = await publishedPost({ applyUrl: APPLY_URL });
      await app.get(CommentRepository).create({
        igCommentId: "c-1",
        accountId,
        postId,
        igMediaId,
        text: "is this remote?",
        fromIgUserId: "990",
        fromUsername: "jobseeker",
      });
      return postId;
    }

    it("lists a post's comments and the recent comments with a cursor", async () => {
      const postId = await seedComment();
      const forPost = await withKey(http().get(`/posts/${postId}/comments`)).expect(200);
      expect(forPost.body).toHaveLength(1);
      expect(forPost.body[0]).toMatchObject({
        id: "c-1",
        igCommentId: "c-1",
        author: "jobseeker",
        text: "is this remote?",
        status: "RECEIVED",
        replyText: null,
        dmText: null,
      });
      const recent = await withSession(http().get(`/comments?accountId=${accountId}&limit=1`)).expect(200);
      expect(recent.body.items.map((c: { id: string }) => c.id)).toEqual(["c-1"]);
      expect(recent.body.nextCursor).toBeNull();
      await withKey(http().get("/comments")).expect(400);
      await withKey(http().get(`/comments?accountId=${accountId}&status=NOPE`)).expect(400);
    });

    it("dry run: reply, dm, hide and delete record without calling Instagram", async () => {
      const postId = await seedComment();
      const ig = app.get(FakeInstagramAdapter);
      const reply = await withKey(http().post("/comments/c-1/reply").send({ postId, text: "Yes, remote." })).expect(200);
      expect(reply.body).toMatchObject({ status: "HUMAN_REPLIED", replyText: "Yes, remote." });
      expect(reply.body.replyId).toMatch(/^dryrun-/);
      const dm = await withKey(http().post("/comments/c-1/dm").send({ postId, text: "Link" })).expect(200);
      expect(dm.body.dmId).toMatch(/^dryrun-/);
      await withKey(http().post("/comments/c-1/hide").send({ postId, hidden: true })).expect(200);
      const del = await withSession(http().delete(`/comments/c-1?postId=${postId}`)).expect(200);
      expect(del.body.deleted).toBe(true);
      expect([ig.getReplies(), ig.getDms(), ig.getHides(), ig.getDeletes()].flat()).toHaveLength(0);
      const audit = await app.get(AuditRepository).list(accountId);
      expect(audit.map((e) => e.action)).toEqual(
        expect.arrayContaining(["comment.reply", "comment.dm", "comment.hide", "comment.delete"]),
      );
      await withKey(http().post("/comments/c-1/reply").send({ postId, text: "again" })).expect(409);
    });

    it("live (fake adapter): reply, dm, hide, unhide and delete reach the port", async () => {
      const postId = await seedComment();
      await app.get(AccountRepository).update(accountId, { dryRun: false });
      const ig = app.get(FakeInstagramAdapter);
      await withKey(http().post("/comments/c-1/reply").send({ postId, text: "Yes." })).expect(200);
      await withKey(http().post("/comments/c-1/dm").send({ postId, text: "Link" })).expect(200);
      await withKey(http().post("/comments/c-1/hide").send({ postId, hidden: true })).expect(200);
      await withKey(http().post("/comments/c-1/hide").send({ postId, hidden: false })).expect(200);
      await withKey(http().delete(`/comments/c-1?postId=${postId}`)).expect(200);
      expect(ig.getReplies()[0]).toMatchObject({ commentId: "c-1", text: "Yes." });
      expect(ig.getDms()[0]).toMatchObject({ commentId: "c-1", text: "Link" });
      expect(ig.getHides().map((h) => h.hidden)).toEqual([true, false]);
      expect(ig.getDeletes()).toEqual([{ accountId, commentId: "c-1" }]);
    });

    it("answers 400 for a bad body, 404 for an unknown comment and 429 over the cap", async () => {
      const postId = await seedComment();
      await withKey(http().post("/comments/c-1/reply").send({ postId })).expect(400);
      await withKey(http().post("/comments/c-1/hide").send({ postId, hidden: "yes" })).expect(400);
      await withKey(http().post("/comments/c-1/reply").send({ text: "x" })).expect(400);
      await withKey(http().post("/comments/nope/reply").send({ postId, text: "x" })).expect(404);

      await app.get(AccountRepository).update(accountId, { replyCapPerPostPerHour: 1 });
      await withKey(http().post("/comments/c-1/reply").send({ postId, text: "one" })).expect(200);
      await withKey(http().post("/comments/c-1/dm").send({ postId, text: "two" })).expect(429);
    });
  });

  describe("carousel and reel handoff", () => {
    const card = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({ contentId: "content-1", title: "Five roles this week", ...extra });

    function carousel(count: number, cardJson = card(), mime = "image/png") {
      const req = withKey(http().post("/handoff/carousel")).field("card", cardJson);
      for (let i = 0; i < count; i++) {
        req.attach("files[]", PNG, { filename: `s${i}.png`, contentType: mime });
      }
      return req;
    }

    it("creates a CAROUSEL, repeats with 200, and checks the file count and type", async () => {
      const first = await carousel(3, card({ keyword: "ZOHO" })).expect(201);
      expect(first.body).toMatchObject({ status: "PENDING_APPROVAL", created: true });
      expect(first.body.caption).toBe("Five roles this week\n\nComment ZOHO and we'll DM you the link.");
      const post = await app.get(PostRepository).get(accountId, first.body.postId);
      expect(post).toMatchObject({ format: "CAROUSEL", keyword: "ZOHO" });
      expect(post?.mediaAssetIds).toHaveLength(3);

      const again = await carousel(3, card({ keyword: "ZOHO" })).expect(200);
      expect(again.body).toMatchObject({ postId: first.body.postId, created: false });

      await carousel(1, card({ contentId: "c-2" })).expect(400);
      await carousel(11, card({ contentId: "c-3" })).expect(400);
      await carousel(2, card({ contentId: "c-4" }), "image/webp").expect(400);
      await carousel(2, "{nope").expect(400);
    });

    it("rejects the carousel handoff without the key", async () => {
      await http().post("/handoff/carousel").field("card", card()).attach("files[]", PNG, { filename: "a.png", contentType: "image/png" }).expect(401);
    });

    it("creates a REEL, repeats with 200 and rejects images", async () => {
      const send = (contentId: string, mime = "video/mp4") =>
        withKey(http().post("/handoff/reel"))
          .field("card", card({ contentId }))
          .attach("file", Buffer.alloc(100, 1), { filename: "r.mp4", contentType: mime });
      const first = await send("reel-1").expect(201);
      expect(await app.get(PostRepository).get(accountId, first.body.postId)).toMatchObject({ format: "REEL" });
      const again = await send("reel-1").expect(200);
      expect(again.body.postId).toBe(first.body.postId);
      await send("reel-2", "image/png").expect(400);
    });
  });

  describe("carousel publish", () => {
    async function approvedCarousel() {
      const posts = app.get(PostRepository);
      const pending = await makePost({ format: "CAROUSEL", assets: 3 });
      await app.get(AccountRepository).update(accountId, { dryRun: false });
      const stored = await posts.transition({
        accountId,
        postId: pending.id,
        expectedStatus: "PENDING_APPROVAL",
        expectedVersion: pending.version,
        nextStatus: "APPROVED",
      });
      return stored;
    }

    it("publishes children, then the carousel, then the post", async () => {
      const post = await approvedCarousel();
      const ig = app.get(FakeInstagramAdapter);
      ig.setProcessingPolls(0);
      await app.get(PublishProcessor).process({ accountId, postId: post.id });
      const poller = app.get(PollContainerProcessor);
      expect(await poller.process({ accountId, postId: post.id, attempt: 1 })).toBe("pending");
      expect(await poller.process({ accountId, postId: post.id, attempt: 1 })).toBe("published");
      expect(ig.getContainerInputs().map((i) => i.format)).toEqual(["IMAGE", "IMAGE", "IMAGE", "CAROUSEL"]);
      expect(await app.get(PostRepository).get(accountId, post.id)).toMatchObject({ status: "PUBLISHED" });
    });

    it("fails the post with a message when a child errors", async () => {
      const post = await approvedCarousel();
      app.get(FakeInstagramAdapter).failNextContainer("MEDIA_INVALID");
      await app.get(PublishProcessor).process({ accountId, postId: post.id });
      expect(await app.get(PollContainerProcessor).process({ accountId, postId: post.id, attempt: 1 })).toBe("failed");
      expect(await app.get(PostRepository).get(accountId, post.id)).toMatchObject({
        status: "FAILED",
        failureReason: "instagram rejected carousel slide 1",
      });
    });
  });

  describe("retry, posts and approvals", () => {
    it("retries a failed post, and answers 409 for one that is not retryable", async () => {
      const posts = app.get(PostRepository);
      const pending = await makePost();
      await withKey(http().post(`/posts/${pending.id}/retry`).send({ accountId })).expect(409);

      const approved = await posts.transition({
        accountId,
        postId: pending.id,
        expectedStatus: "PENDING_APPROVAL",
        expectedVersion: pending.version,
        nextStatus: "APPROVED",
      });
      const publishing = await posts.transition({
        accountId,
        postId: pending.id,
        expectedStatus: "APPROVED",
        expectedVersion: approved.version,
        nextStatus: "PUBLISHING",
      });
      await withKey(http().post(`/posts/${pending.id}/retry?accountId=${accountId}`)).expect(409);

      await posts.transition({
        accountId,
        postId: pending.id,
        expectedStatus: "PUBLISHING",
        expectedVersion: publishing.version,
        nextStatus: "FAILED",
        patch: { failureReason: "container timeout", containerId: "c-1" },
      });
      const res = await withSession(http().post(`/posts/${pending.id}/retry`).send({ accountId })).expect(200);
      expect(res.body).toMatchObject({ status: "APPROVED", error: null });
      expect(res.body.containerId).toBeUndefined();
      const entries = await app.get(AuditRepository).list(accountId);
      expect(entries.map((e) => e.action)).toContain("POST_RETRY");
      await withKey(http().post("/posts/nope/retry").send({ accountId })).expect(404);
    });

    it("GET /posts and GET /posts/:id carry the lifecycle fields", async () => {
      const { postId } = await publishedPost({ keyword: "ZOHO" });
      const list = await withKey(http().get(`/posts?accountId=${accountId}&status=PUBLISHED`)).expect(200);
      expect(list.body[0]).toMatchObject({
        id: postId,
        format: "IMAGE",
        keyword: "ZOHO",
        status: "PUBLISHED",
        error: null,
      });
      for (const field of ["igMediaId", "scheduledAt", "updatedAt"]) {
        expect(list.body[0][field]).toBeTypeOf("string");
      }
      const one = await withSession(http().get(`/posts/${postId}`)).expect(200);
      expect(one.body.id).toBe(postId);
      await withKey(http().get(`/posts/nope?accountId=${accountId}`)).expect(404);
    });

    it("approves with edits and rejects through the key", async () => {
      const a = await makePost();
      const b = await makePost();
      const approved = await withKey(
        http().post(`/approvals/${a.id}/approve`).send({
          accountId,
          expectedVersion: a.version,
          caption: "Edited caption",
          scheduledAt: "2030-01-01T09:00:00.000Z",
        }),
      ).expect(200);
      expect(approved.body).toMatchObject({
        status: "APPROVED",
        caption: "Edited caption",
        scheduledAt: "2030-01-01T09:00:00.000Z",
      });
      const rejected = await withKey(
        http().post(`/approvals/${b.id}/reject`).send({ accountId, expectedVersion: b.version }),
      ).expect(200);
      expect(rejected.body.status).toBe("REJECTED");
      await withKey(
        http().post(`/approvals/${b.id}/reject`).send({ accountId, expectedVersion: b.version }),
      ).expect(409);
    });
  });
});
