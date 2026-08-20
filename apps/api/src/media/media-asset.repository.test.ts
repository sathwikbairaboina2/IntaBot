import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { MediaAssetRepository } from "./media-asset.repository";

const repo = new MediaAssetRepository(docClient, tableMain);

const input = {
  accountId: "acct-1",
  storageKey: "acct-1/a1.jpg",
  contentType: "image/jpeg",
  sizeBytes: 2048,
};

describe("MediaAssetRepository", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("creates an asset with a generated id", async () => {
    const asset = await repo.create(input);
    expect(asset.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(asset.draftFailed).toBeUndefined();
  });

  it("reads an asset back", async () => {
    const created = await repo.create(input);
    expect((await repo.get("acct-1", created.id))?.storageKey).toBe("acct-1/a1.jpg");
  });

  it("returns null for an unknown asset", async () => {
    expect(await repo.get("acct-1", "nope")).toBeNull();
  });

  it("marks an asset as failed to draft", async () => {
    const created = await repo.create(input);
    await repo.markDraftFailed("acct-1", created.id);
    expect((await repo.get("acct-1", created.id))?.draftFailed).toBe(true);
  });
});
