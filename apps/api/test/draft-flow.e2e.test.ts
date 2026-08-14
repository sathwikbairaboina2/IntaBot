import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { FakeCopyWriter } from "../src/content/fake-copy-writer";
import { DraftProcessor } from "../src/jobs/draft.processor";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

describe("draft flow", () => {
  let app: INestApplication;
  let accountId: string;
  let assetId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    app.get(FakeCopyWriter).reset();
    const account = await app.get(AccountRepository).create({
      name: "Studio Nord",
      igUserId: "1784140",
      username: "studionord",
      accessTokenEncrypted: "v1:a:b:c",
      tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    const asset = await app.get(MediaAssetRepository).create({
      accountId,
      storageKey: `${accountId}/a.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 1024,
    });
    assetId = asset.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("turns an asset into a PENDING_APPROVAL post", async () => {
    await app.get(DraftProcessor).process({ accountId, assetId, format: "IMAGE" });

    const queue = await app.get(PostRepository).listByStatus(accountId, "PENDING_APPROVAL");
    expect(queue).toHaveLength(1);
    expect(queue[0]?.caption.length).toBeGreaterThan(0);
    expect(queue[0]?.mediaAssetIds).toEqual([assetId]);
    expect(queue[0]?.version).toBe(2);
  });

  it("flags the post when the copy writer refuses, and still queues it", async () => {
    app.get(FakeCopyWriter).setNextRefusal();
    await app.get(DraftProcessor).process({ accountId, assetId, format: "IMAGE" });

    const queue = await app.get(PostRepository).listByStatus(accountId, "PENDING_APPROVAL");
    expect(queue[0]?.needsAttention).toBe(true);
    expect(queue[0]?.caption).toBe("");
  });

  it("does not schedule two posts into the same slot", async () => {
    const second = await app.get(MediaAssetRepository).create({
      accountId,
      storageKey: `${accountId}/b.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 1024,
    });
    await app.get(DraftProcessor).process({ accountId, assetId, format: "IMAGE" });
    await app.get(DraftProcessor).process({ accountId, assetId: second.id, format: "IMAGE" });

    const queue = await app.get(PostRepository).listByStatus(accountId, "PENDING_APPROVAL");
    const slots = queue.map((p) => p.scheduledAt);
    expect(new Set(slots).size).toBe(2);
  });

  it("marks the asset draftFailed when drafting throws", async () => {
    const writer = app.get(FakeCopyWriter);
    const original = writer.draft.bind(writer);
    writer.draft = async () => {
      throw new Error("network down");
    };
    try {
      await expect(
        app.get(DraftProcessor).process({ accountId, assetId, format: "IMAGE" }),
      ).rejects.toThrow("network down");
    } finally {
      writer.draft = original;
    }
    expect((await app.get(MediaAssetRepository).get(accountId, assetId))?.draftFailed).toBe(true);
  });
});
