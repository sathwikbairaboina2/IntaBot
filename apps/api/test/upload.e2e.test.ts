import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { QUEUE } from "../src/jobs/queue.constants";
import { resetTables } from "./dynamo-fixture";
import { drainQueues, testQueue } from "./queue-fixture";

describe("upload", () => {
  let app: INestApplication;
  let cookie: string;
  let accountId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.draft]);
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
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer())
      .post("/media")
      .field("accountId", accountId)
      .attach("file", Buffer.from("x"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(401);
  });

  it("accepts a jpeg and returns an asset id", async () => {
    const res = await request(app.getHttpServer())
      .post("/media")
      .set("Cookie", cookie)
      .field("accountId", accountId)
      .attach("file", Buffer.from("fake-jpeg-bytes"), {
        filename: "a.jpg",
        contentType: "image/jpeg",
      })
      .expect(202);
    expect(res.body.assetId).toBeTruthy();
    expect(res.body.format).toBe("IMAGE");
  });

  it("enqueues exactly one drafting job per upload", async () => {
    await request(app.getHttpServer())
      .post("/media")
      .set("Cookie", cookie)
      .field("accountId", accountId)
      .attach("file", Buffer.from("bytes"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(202);

    const q = testQueue(QUEUE.draft);
    expect(await q.getWaitingCount()).toBe(1);
    await q.close();
  });

  it("rejects an unsupported type with 400 and enqueues nothing", async () => {
    await request(app.getHttpServer())
      .post("/media")
      .set("Cookie", cookie)
      .field("accountId", accountId)
      .attach("file", Buffer.from("%PDF"), { filename: "a.pdf", contentType: "application/pdf" })
      .expect(400);

    const q = testQueue(QUEUE.draft);
    expect(await q.getWaitingCount()).toBe(0);
    await q.close();
  });

  it("returns 404 for an unknown account", async () => {
    await request(app.getHttpServer())
      .post("/media")
      .set("Cookie", cookie)
      .field("accountId", "nope")
      .attach("file", Buffer.from("bytes"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(404);
  });
});
