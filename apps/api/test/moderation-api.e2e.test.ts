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
import { CommentRepository } from "../src/moderation/comment.repository";
import { resetTables } from "./dynamo-fixture";

describe("moderation api", () => {
  let app: INestApplication;
  let cookie: string;
  let accountId: string;
  let version: number;
  const postId = "post-1";
  const igCommentId = "c-esc";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    app.get(FakeInstagramAdapter).reset();
    await app.get(UserRepository).create("op@example.com", await app.get(PasswordService).hash("pw"));
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "op@example.com", password: "pw" });
    cookie = login.headers["set-cookie"]!;

    const account = await app.get(AccountRepository).create({
      name: "Studio Nord",
      igUserId: "1784140",
      username: "studionord",
      accessTokenEncrypted: "v1:a:b:c",
      tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    await app.get(AccountRepository).update(accountId, { dryRun: false });

    const comments = app.get(CommentRepository);
    const received = await comments.create({
      igCommentId,
      accountId,
      postId,
      igMediaId: "m-1",
      text: "This arrived broken.",
      fromIgUserId: "990",
      fromUsername: "buyer",
    });
    const escalated = await comments.transition({
      postId,
      igCommentId,
      accountId,
      expectedStatus: "RECEIVED",
      expectedVersion: received!.version,
      nextStatus: "ESCALATED",
      patch: { policyRule: "needs-human" },
    });
    version = escalated.version;

    const auto = await comments.create({
      igCommentId: "c-auto",
      accountId,
      postId,
      igMediaId: "m-1",
      text: "Love it",
      fromIgUserId: "991",
      fromUsername: "fan",
    });
    await comments.transition({
      postId,
      igCommentId: "c-auto",
      accountId,
      expectedStatus: "RECEIVED",
      expectedVersion: auto!.version,
      nextStatus: "AUTO_REPLIED",
      patch: { replyText: "Thanks!", replyId: "r-1" },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get(`/moderation?accountId=${accountId}`).expect(401);
  });

  it("requires accountId", async () => {
    await request(app.getHttpServer()).get("/moderation").set("Cookie", cookie).expect(400);
  });

  it("lists escalated comments and recent auto-replies separately", async () => {
    const res = await request(app.getHttpServer())
      .get(`/moderation?accountId=${accountId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.escalated).toHaveLength(1);
    expect(res.body.escalated[0].igCommentId).toBe(igCommentId);
    expect(res.body.recentAutoReplies).toHaveLength(1);
    expect(res.body.recentAutoReplies[0].replyText).toBe("Thanks!");
  });

  it("posts a human reply through the port and audits it", async () => {
    const res = await request(app.getHttpServer())
      .post(`/moderation/${igCommentId}/reply`)
      .set("Cookie", cookie)
      .send({ accountId, postId, expectedVersion: version, text: "So sorry — DM us." })
      .expect(200);
    expect(res.body.status).toBe("HUMAN_REPLIED");
    expect(res.body.replyText).toBe("So sorry — DM us.");

    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(1);
    const audit = await app.get(AuditRepository).list(accountId);
    expect(audit.at(-1)).toMatchObject({ actor: "human", action: "HUMAN_REPLIED" });
  });

  it("returns 409 on a stale version and sends nothing", async () => {
    await request(app.getHttpServer())
      .post(`/moderation/${igCommentId}/reply`)
      .set("Cookie", cookie)
      .send({ accountId, postId, expectedVersion: version, text: "First reply." })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/moderation/${igCommentId}/reply`)
      .set("Cookie", cookie)
      .send({ accountId, postId, expectedVersion: version, text: "Second reply." })
      .expect(409);
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(1);
  });

  it("skips the port for dry-run accounts", async () => {
    await app.get(AccountRepository).update(accountId, { dryRun: true });
    const res = await request(app.getHttpServer())
      .post(`/moderation/${igCommentId}/reply`)
      .set("Cookie", cookie)
      .send({ accountId, postId, expectedVersion: version, text: "Reply." })
      .expect(200);
    expect(res.body.replyId).toMatch(/^dryrun-/);
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(0);
  });

  it("dismisses an escalation", async () => {
    const res = await request(app.getHttpServer())
      .post(`/moderation/${igCommentId}/dismiss`)
      .set("Cookie", cookie)
      .send({ accountId, postId, expectedVersion: version })
      .expect(200);
    expect(res.body.status).toBe("IGNORED");
    expect(res.body.policyRule).toBe("human-dismissed");
  });

  it("accepts moderation policy fields on account PATCH", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}`)
      .set("Cookie", cookie)
      .send({ blocklist: ["giveaway"], replyCapPerPostPerHour: 2 })
      .expect(200);
    expect(res.body.blocklist).toEqual(["giveaway"]);
    expect(res.body.replyCapPerPostPerHour).toBe(2);
  });
});
