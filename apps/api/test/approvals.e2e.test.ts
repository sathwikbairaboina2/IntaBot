import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

describe("approvals", () => {
  let app: INestApplication;
  let cookie: string;
  let accountId: string;
  let postId: string;
  let version: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
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

    const posts = app.get(PostRepository);
    const draft = await posts.create({
      accountId,
      format: "IMAGE",
      mediaAssetIds: ["a1"],
      caption: "Draft copy.",
      hashtags: ["#studio"],
      scheduledAt: "2026-08-20T09:00:00.000Z",
    });
    const pending = await posts.transition({
      accountId,
      postId: draft.id,
      expectedStatus: "DRAFT",
      expectedVersion: draft.version,
      nextStatus: "PENDING_APPROVAL",
    });
    postId = pending.id;
    version = pending.version;
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get(`/approvals?accountId=${accountId}`).expect(401);
  });

  it("lists pending posts", async () => {
    const res = await request(app.getHttpServer())
      .get(`/approvals?accountId=${accountId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].caption).toBe("Draft copy.");
  });

  it("approves a post", async () => {
    const res = await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`)
      .set("Cookie", cookie)
      .send({ accountId, expectedVersion: version })
      .expect(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.version).toBe(version + 1);
  });

  it("applies an edited caption on approval", async () => {
    const res = await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`)
      .set("Cookie", cookie)
      .send({ accountId, expectedVersion: version, caption: "Human wrote this." })
      .expect(200);
    expect(res.body.caption).toBe("Human wrote this.");
  });

  it("returns 409 when the version is stale", async () => {
    await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`)
      .set("Cookie", cookie)
      .send({ accountId, expectedVersion: version })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`)
      .set("Cookie", cookie)
      .send({ accountId, expectedVersion: version })
      .expect(409);
  });

  it("rejects a post", async () => {
    const res = await request(app.getHttpServer())
      .post(`/approvals/${postId}/reject`)
      .set("Cookie", cookie)
      .send({ accountId, expectedVersion: version })
      .expect(200);
    expect(res.body.status).toBe("REJECTED");
  });

  it("returns 400 when expectedVersion is missing", async () => {
    await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`)
      .set("Cookie", cookie)
      .send({ accountId })
      .expect(400);
  });
});
