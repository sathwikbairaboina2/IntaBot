import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { MAX_POLL_ATTEMPTS, PollContainerProcessor } from "../src/jobs/poll-container.processor";
import { PublishProcessor } from "../src/jobs/publish.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { IgMediaRefRepository } from "../src/moderation/ig-media-ref.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues } from "./queue-fixture";

describe("poll flow", () => {
  let app: INestApplication;
  let accountId: string;
  let postId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.publish, QUEUE.pollContainer]);
    app.get(FakeInstagramAdapter).reset();

    const account = await app.get(AccountRepository).create({
      name: "Studio Nord",
      igUserId: "1784140",
      username: "studionord",
      accessTokenEncrypted: "v1:a:b:c",
      tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    await app.get(AccountRepository).update(accountId, { dryRun: false });

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
      caption: "Copy.",
      hashtags: ["#studio"],
      scheduledAt: "2020-01-01T00:00:00.000Z",
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
    postId = draft.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports pending while the container is still processing", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(3);
    await app.get(PublishProcessor).process({ accountId, postId });

    const outcome = await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });
    expect(outcome).toBe("pending");
    expect((await app.get(PostRepository).get(accountId, postId))?.status).toBe("PUBLISHING");
  });

  it("publishes once the container finishes", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(0);
    await app.get(PublishProcessor).process({ accountId, postId });

    const outcome = await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });
    expect(outcome).toBe("published");

    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("PUBLISHED");
    expect(post?.permalink).toContain("instagram.test");
    expect(post?.igMediaId).toBeTruthy();
  });

  it("fails the post when the container errors", async () => {
    app.get(FakeInstagramAdapter).failNextContainer("MEDIA_TOO_LARGE");
    await app.get(PublishProcessor).process({ accountId, postId });

    const outcome = await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });
    expect(outcome).toBe("failed");

    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("FAILED");
    expect(post?.failureReason).toBeTruthy();
  });

  it("fails the post after the final attempt", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(1000);
    await app.get(PublishProcessor).process({ accountId, postId });

    const outcome = await app
      .get(PollContainerProcessor)
      .process({ accountId, postId, attempt: MAX_POLL_ATTEMPTS });
    expect(outcome).toBe("failed");

    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("FAILED");
    expect(post?.failureReason).toMatch(/timeout/i);
  });

  it("publishes exactly one Instagram media even when polled twice", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(0);
    await app.get(PublishProcessor).process({ accountId, postId });

    await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });
    await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 2 });

    expect(app.get(FakeInstagramAdapter).getPublished()).toHaveLength(1);
  });

  it("writes an ig-media inverse item when a live publish lands", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(0);
    await app.get(PublishProcessor).process({ accountId, postId });
    await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });

    const post = await app.get(PostRepository).get(accountId, postId);
    const ref = await app.get(IgMediaRefRepository).get(post!.igMediaId!);
    expect(ref).toEqual({ accountId, postId });
  });
});
