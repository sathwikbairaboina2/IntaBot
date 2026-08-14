import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { FakeCopyWriter } from "../src/content/fake-copy-writer";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { DraftProcessor } from "../src/jobs/draft.processor";
import { PollContainerProcessor } from "../src/jobs/poll-container.processor";
import { PublishScanProcessor } from "../src/jobs/publish-scan.processor";
import { PublishProcessor } from "../src/jobs/publish.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues } from "./queue-fixture";

describe("phase 2 smoke", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.draft, QUEUE.publish, QUEUE.pollContainer]);
    app.get(FakeCopyWriter).reset();
    app.get(FakeInstagramAdapter).reset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("carries an upload through drafting, approval and publishing", async () => {
    // 1. Operator and account.
    await app.get(UserRepository).create("op@example.com", await app.get(PasswordService).hash("pw"));
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "op@example.com", password: "pw" })
      .expect(200);
    const cookie = login.headers["set-cookie"]!;

    const account = await app.get(AccountRepository).create({
      name: "Studio Nord",
      igUserId: "1784140",
      username: "studionord",
      accessTokenEncrypted: "v1:a:b:c",
      tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    await app.get(AccountRepository).update(account.id, { dryRun: false });

    // 2. Upload.
    const upload = await request(app.getHttpServer())
      .post("/media")
      .set("Cookie", cookie)
      .field("accountId", account.id)
      .attach("file", Buffer.from("jpeg-bytes"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(202);

    // 3. Draft (workers are not running in tests, so drive the processor).
    await app.get(DraftProcessor).process({
      accountId: account.id,
      assetId: upload.body.assetId,
      format: "IMAGE",
    });

    const queue = await request(app.getHttpServer())
      .get(`/approvals?accountId=${account.id}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(queue.body).toHaveLength(1);
    const draft = queue.body[0];

    // 4. Approve, with a human edit and a slot that is already due.
    const approved = await request(app.getHttpServer())
      .post(`/approvals/${draft.id}/approve`)
      .set("Cookie", cookie)
      .send({
        accountId: account.id,
        expectedVersion: draft.version,
        caption: "Human wrote this.",
        scheduledAt: "2020-01-01T00:00:00.000Z",
      })
      .expect(200);
    expect(approved.body.status).toBe("APPROVED");

    // 5. Scan picks it up.
    expect((await app.get(PublishScanProcessor).process()).enqueued).toBe(1);

    // 6. Publish and poll.
    app.get(FakeInstagramAdapter).setProcessingPolls(1);
    await app.get(PublishProcessor).process({ accountId: account.id, postId: draft.id });
    expect(
      await app
        .get(PollContainerProcessor)
        .process({ accountId: account.id, postId: draft.id, attempt: 1 }),
    ).toBe("pending");
    expect(
      await app
        .get(PollContainerProcessor)
        .process({ accountId: account.id, postId: draft.id, attempt: 2 }),
    ).toBe("published");

    // 7. End state.
    const post = await app.get(PostRepository).get(account.id, draft.id);
    expect(post?.status).toBe("PUBLISHED");
    expect(post?.caption).toBe("Human wrote this.");
    expect(post?.permalink).toContain("instagram.test");
    expect(app.get(FakeInstagramAdapter).getPublished()).toHaveLength(1);
    expect(await app.get(PostRepository).listByStatus(account.id, "PENDING_APPROVAL")).toHaveLength(
      0,
    );
  });
});
