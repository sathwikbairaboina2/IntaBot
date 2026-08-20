import { createHmac } from "node:crypto";
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
import { INSTAGRAM_PORT } from "../src/instagram/instagram.port";
import { ModerationProcessor } from "../src/jobs/moderation.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { CommentRepository } from "../src/moderation/comment.repository";
import { IgMediaRefRepository } from "../src/moderation/ig-media-ref.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues, testQueue } from "./queue-fixture";

const SECRET = process.env.META_APP_SECRET!;

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function webhookBody(commentId: string, text: string, mediaId: string): string {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "1784140",
        changes: [
          {
            field: "comments",
            value: {
              id: commentId,
              media: { id: mediaId },
              from: { id: "990", username: "buyer" },
              text,
            },
          },
        ],
      },
    ],
  });
}

/**
 * The whole Phase 3 loop through the fakes: a signed webhook auto-replies to
 * praise; a complaint escalates, shows up in the moderation queue, and a human
 * answers it through the API. Exactly one Instagram reply per comment,
 * regardless of redelivery.
 */
describe("phase 3 smoke", () => {
  let app: INestApplication;
  let cookie: string;
  let accountId: string;
  let postId: string;
  const igMediaId = "smoke-media-1";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.moderation]);
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

  it("boots with the fake adapter by default", () => {
    expect(app.get(INSTAGRAM_PORT)).toBeInstanceOf(FakeInstagramAdapter);
  });

  it("runs webhook → auto-reply and webhook → escalate → human reply end to end", async () => {
    // 1. Praise arrives via a signed webhook and is enqueued.
    const praise = webhookBody("smoke-c1", "Love this!", igMediaId);
    await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(praise))
      .send(praise)
      .expect(200);

    const q = testQueue(QUEUE.moderation);
    const [praiseJob] = await q.getWaiting();
    expect(praiseJob).toBeTruthy();

    // 2. The worker auto-replies exactly once.
    await app.get(ModerationProcessor).process(praiseJob!.data);
    const replied = await app.get(CommentRepository).get(postId, "smoke-c1");
    expect(replied?.status).toBe("AUTO_REPLIED");
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(1);

    // 3. A complaint escalates instead.
    const complaint = webhookBody("smoke-c2", "Mine arrived broken, I want a refund.", igMediaId);
    await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(complaint))
      .send(complaint)
      .expect(200);
    const jobs = await q.getWaiting();
    const complaintJob = jobs.find((j) => j.data.igCommentId === "smoke-c2");
    await app.get(ModerationProcessor).process(complaintJob!.data);

    // 4. It shows up in the moderation queue.
    const list = await request(app.getHttpServer())
      .get(`/moderation?accountId=${accountId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(list.body.escalated).toHaveLength(1);
    const escalated = list.body.escalated[0];
    expect(escalated.igCommentId).toBe("smoke-c2");

    // 5. A human answers it through the API.
    await request(app.getHttpServer())
      .post(`/moderation/smoke-c2/reply`)
      .set("Cookie", cookie)
      .send({
        accountId,
        postId,
        expectedVersion: escalated.version,
        text: "So sorry — we'll make this right. Check your DMs.",
      })
      .expect(200);
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(2);

    // 6. Redelivering the complaint webhook enqueues nothing new (the
    // original job is still in the queue because tests drive processors
    // directly instead of running workers).
    const before = (await q.getWaiting()).length;
    const redelivery = await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(complaint))
      .send(complaint)
      .expect(200);
    expect(redelivery.body.received).toBe(0);
    expect((await q.getWaiting()).length).toBe(before);
    expect(app.get(FakeInstagramAdapter).getReplies()).toHaveLength(2);

    // 7. Every decision is on the audit log.
    const audit = await app.get(AuditRepository).list(accountId);
    const actions = audit.map((a) => `${a.actor}:${a.action}`);
    expect(actions).toContain("agent:AUTO_REPLIED");
    expect(actions).toContain("agent:ESCALATED");
    expect(actions).toContain("human:HUMAN_REPLIED");

    await q.close();
  });
});
