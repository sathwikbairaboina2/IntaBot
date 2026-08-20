import { createHmac } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { QUEUE } from "../src/jobs/queue.constants";
import { resetTables } from "./dynamo-fixture";
import { drainQueues, testQueue } from "./queue-fixture";

const SECRET = process.env.META_APP_SECRET!;

function payload(commentId = "c-9"): object {
  return {
    object: "instagram",
    entry: [
      {
        id: "1784140",
        changes: [
          {
            field: "comments",
            value: {
              id: commentId,
              media: { id: "m-7" },
              from: { id: "990", username: "fan" },
              text: "Nice!",
            },
          },
        ],
      },
    ],
  };
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

describe("webhooks", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.moderation]);
    await app.get(AccountRepository).create({
      name: "Studio Nord",
      igUserId: "1784140",
      username: "studionord",
      accessTokenEncrypted: "v1:a:b:c",
      tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("echoes the verification challenge for the right token", async () => {
    const res = await request(app.getHttpServer())
      .get("/webhooks/instagram")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "test-verify-token", "hub.challenge": "42" })
      .expect(200);
    expect(res.text).toBe("42");
  });

  it("refuses the challenge for a wrong token", async () => {
    await request(app.getHttpServer())
      .get("/webhooks/instagram")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" })
      .expect(403);
  });

  it("accepts a signed webhook and enqueues one moderation job", async () => {
    const body = JSON.stringify(payload());
    const res = await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body)
      .expect(200);
    expect(res.body.received).toBe(1);

    const q = testQueue(QUEUE.moderation);
    expect(await q.getWaitingCount()).toBe(1);
    const [job] = await q.getWaiting();
    expect(job!.data).toMatchObject({ igCommentId: "c-9", igMediaId: "m-7", text: "Nice!" });
    await q.close();
  });

  it("rejects a forged signature and enqueues nothing", async () => {
    const body = JSON.stringify(payload());
    await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=" + "0".repeat(64))
      .send(body)
      .expect(401);

    const q = testQueue(QUEUE.moderation);
    expect(await q.getWaitingCount()).toBe(0);
    await q.close();
  });

  it("drops a redelivered event", async () => {
    const body = JSON.stringify(payload());
    await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body)
      .expect(200);
    const res = await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body)
      .expect(200);
    expect(res.body.received).toBe(0);

    const q = testQueue(QUEUE.moderation);
    expect(await q.getWaitingCount()).toBe(1);
    await q.close();
  });

  it("skips events for unknown accounts", async () => {
    const unknown = {
      object: "instagram",
      entry: [
        {
          id: "999999",
          changes: [
            {
              field: "comments",
              value: {
                id: "c-1",
                media: { id: "m-1" },
                from: { id: "990", username: "fan" },
                text: "hi",
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(unknown);
    const res = await request(app.getHttpServer())
      .post("/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body)
      .expect(200);
    expect(res.body.received).toBe(0);
  });
});
