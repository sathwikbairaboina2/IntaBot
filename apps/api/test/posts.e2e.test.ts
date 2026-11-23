import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

describe("GET /posts", () => {
  let app: INestApplication;
  let cookie: string;
  let approvedId: string;

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

    const posts = app.get(PostRepository);
    const make = async (caption: string) => {
      const draft = await posts.create({
        accountId: "acct-1",
        format: "IMAGE",
        mediaAssetIds: ["a1"],
        caption,
        hashtags: [],
        scheduledAt: "2026-08-15T09:00:00.000Z",
      });
      return posts.transition({
        accountId: "acct-1",
        postId: draft.id,
        expectedStatus: "DRAFT",
        expectedVersion: draft.version,
        nextStatus: "PENDING_APPROVAL",
      });
    };
    const pending = await make("pending one");
    const toApprove = await make("approved one");
    const approved = await posts.transition({
      accountId: "acct-1",
      postId: toApprove.id,
      expectedStatus: "PENDING_APPROVAL",
      expectedVersion: toApprove.version,
      nextStatus: "APPROVED",
    });
    approvedId = approved.id;
    expect(pending.status).toBe("PENDING_APPROVAL");
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get("/posts?accountId=acct-1&status=APPROVED").expect(401);
  });

  it("lists the posts of an account in one status", async () => {
    const res = await request(app.getHttpServer())
      .get("/posts?accountId=acct-1&status=APPROVED")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual([approvedId]);
    expect(res.body[0].status).toBe("APPROVED");
  });

  it("returns an empty list for a status with no posts", async () => {
    const res = await request(app.getHttpServer())
      .get("/posts?accountId=acct-1&status=PUBLISHED")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it("requires accountId and a valid status", async () => {
    await request(app.getHttpServer()).get("/posts?status=APPROVED").set("Cookie", cookie).expect(400);
    await request(app.getHttpServer()).get("/posts?accountId=acct-1").set("Cookie", cookie).expect(400);
    await request(app.getHttpServer())
      .get("/posts?accountId=acct-1&status=BOGUS")
      .set("Cookie", cookie)
      .expect(400);
  });
});
