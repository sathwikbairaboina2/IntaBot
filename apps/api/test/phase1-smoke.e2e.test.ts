import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

describe("phase 1 smoke", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    app.get(FakeInstagramAdapter).reset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("runs the whole slice: login, create account, draft a post, publish it through the fake", async () => {
    // 1. Provision an operator and log in.
    await app
      .get(UserRepository)
      .create("operator@example.com", await app.get(PasswordService).hash("s3cret"));
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" })
      .expect(200);
    const cookie = login.headers["set-cookie"]!;

    // 2. Create an account through the REST surface.
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send({
        name: "Studio Nord",
        igUserId: "17841400000000000",
        username: "studionord",
        accessToken: "IGQVJ-plaintext-token",
        tokenExpiresAt: "2026-10-13T00:00:00.000Z",
      })
      .expect(201);
    const accountId = created.body.id as string;

    // The token must never leave the server, in any form.
    expect(JSON.stringify(created.body)).not.toContain("IGQVJ-plaintext-token");

    // 3. Draft a post and walk it through the approval states.
    const posts = app.get(PostRepository);
    const draft = await posts.create({
      accountId,
      format: "IMAGE",
      mediaAssetIds: ["asset-1"],
      caption: "Morning light.",
      hashtags: ["#studio"],
      scheduledAt: "2026-08-15T09:00:00.000Z",
    });

    const pending = await posts.transition({
      accountId,
      postId: draft.id,
      expectedStatus: "DRAFT",
      expectedVersion: draft.version,
      nextStatus: "PENDING_APPROVAL",
    });
    expect(await posts.listByStatus(accountId, "PENDING_APPROVAL")).toHaveLength(1);

    const approved = await posts.transition({
      accountId,
      postId: draft.id,
      expectedStatus: "PENDING_APPROVAL",
      expectedVersion: pending.version,
      nextStatus: "APPROVED",
    });

    // 4. Publish through the fake Instagram adapter.
    const instagram = app.get(FakeInstagramAdapter);
    instagram.setProcessingPolls(1);

    const account = { ...created.body, accessTokenEncrypted: "v1:a:b:c" };
    const { containerId } = await instagram.createContainer(account, {
      format: "IMAGE",
      mediaUrl: "https://example.test/a.jpg",
      caption: approved.caption,
    });

    const publishing = await posts.transition({
      accountId,
      postId: draft.id,
      expectedStatus: "APPROVED",
      expectedVersion: approved.version,
      nextStatus: "PUBLISHING",
      patch: { containerId },
    });

    expect(await instagram.getContainerStatus(account, containerId)).toBe("IN_PROGRESS");
    expect(await instagram.getContainerStatus(account, containerId)).toBe("FINISHED");

    const result = await instagram.publishContainer(account, containerId);
    const published = await posts.transition({
      accountId,
      postId: draft.id,
      expectedStatus: "PUBLISHING",
      expectedVersion: publishing.version,
      nextStatus: "PUBLISHED",
      patch: { igMediaId: result.igMediaId, permalink: result.permalink },
    });

    // 5. Assert the end state.
    expect(published.status).toBe("PUBLISHED");
    expect(published.permalink).toContain("instagram.test");
    expect(instagram.getPublished()).toHaveLength(1);
    expect(await posts.listByStatus(accountId, "PENDING_APPROVAL")).toHaveLength(0);
  });
});
