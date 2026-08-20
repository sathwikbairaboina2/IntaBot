import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { PublishProcessor } from "../src/jobs/publish.processor";
import { PublishScanProcessor } from "../src/jobs/publish-scan.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { IgMediaRefRepository } from "../src/moderation/ig-media-ref.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues, testQueue } from "./queue-fixture";

describe("publish flow", () => {
  let app: INestApplication;
  let accountId: string;
  let postId: string;

  async function approvedPost(scheduledAt: string): Promise<string> {
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
      hashtags: [],
      scheduledAt,
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
    return draft.id;
  }

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
    postId = await approvedPost("2020-01-01T00:00:00.000Z"); // long overdue
  });

  afterAll(async () => {
    await app.close();
  });

  it("enqueues a due post exactly once", async () => {
    const result = await app.get(PublishScanProcessor).process();
    expect(result.enqueued).toBe(1);

    const q = testQueue(QUEUE.publish);
    expect(await q.getWaitingCount()).toBe(1);
    await q.close();
  });

  it("does not enqueue a post whose slot is in the future", async () => {
    await resetTables();
    const account = await app.get(AccountRepository).create({
      name: "B",
      igUserId: "2",
      username: "b",
      accessTokenEncrypted: "v1:a:b:c",
      tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    await approvedPost("2099-01-01T00:00:00.000Z");
    expect((await app.get(PublishScanProcessor).process()).enqueued).toBe(0);
  });

  it("claims the post before creating a container", async () => {
    await app.get(PublishProcessor).process({ accountId, postId });
    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("PUBLISHING");
    expect(post?.containerId).toBeTruthy();
    expect(app.get(FakeInstagramAdapter).getContainerCount()).toBe(1);
  });

  it("creates only one container when the publish job runs twice", async () => {
    await app.get(PublishProcessor).process({ accountId, postId });
    await app.get(PublishProcessor).process({ accountId, postId });
    expect(app.get(FakeInstagramAdapter).getContainerCount()).toBe(1);
  });

  it("creates no container at all in dry-run mode", async () => {
    await app.get(AccountRepository).update(accountId, { dryRun: true });
    await app.get(PublishProcessor).process({ accountId, postId });

    expect(app.get(FakeInstagramAdapter).getContainerCount()).toBe(0);
    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("PUBLISHED");
    expect(post?.dryRun).toBe(true);
    expect(post?.igMediaId).toMatch(/^dryrun-/);
  });

  it("writes an ig-media inverse item on dry-run publish", async () => {
    await app.get(AccountRepository).update(accountId, { dryRun: true });
    await app.get(PublishProcessor).process({ accountId, postId });

    const post = await app.get(PostRepository).get(accountId, postId);
    const ref = await app.get(IgMediaRefRepository).get(post!.igMediaId!);
    expect(ref).toEqual({ accountId, postId });
  });
});
