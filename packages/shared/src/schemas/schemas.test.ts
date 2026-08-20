import { describe, expect, it } from "vitest";
import { AccountSchema, MediaAssetSchema, PostSchema, UserSchema } from "../index.js";

const account = {
  id: "acct-1",
  name: "Studio Nord",
  igUserId: "17841400000000000",
  username: "studionord",
  status: "ACTIVE",
  accessTokenEncrypted: "v1:aaa:bbb:ccc",
  tokenExpiresAt: "2026-10-13T00:00:00.000Z",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

describe("AccountSchema", () => {
  it("parses a valid account", () => {
    expect(AccountSchema.parse(account).status).toBe("ACTIVE");
  });

  it("rejects an unknown status", () => {
    expect(() => AccountSchema.parse({ ...account, status: "PAUSED" })).toThrow();
  });

  it("rejects a non-ISO tokenExpiresAt", () => {
    expect(() => AccountSchema.parse({ ...account, tokenExpiresAt: "next tuesday" })).toThrow();
  });
});

describe("PostSchema", () => {
  const post = {
    id: "post-1",
    accountId: "acct-1",
    status: "PENDING_APPROVAL",
    format: "REEL",
    version: 1,
    mediaAssetIds: ["asset-1"],
    caption: "Morning light.",
    hashtags: ["#studio"],
    scheduledAt: "2026-08-15T09:00:00.000Z",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };

  it("parses a valid post", () => {
    expect(PostSchema.parse(post).version).toBe(1);
  });

  it("defaults optional publish fields to undefined", () => {
    const parsed = PostSchema.parse(post);
    expect(parsed.igMediaId).toBeUndefined();
    expect(parsed.permalink).toBeUndefined();
  });

  it("rejects a negative version", () => {
    expect(() => PostSchema.parse({ ...post, version: -1 })).toThrow();
  });
});

describe("UserSchema", () => {
  it("lowercases the email", () => {
    const parsed = UserSchema.parse({
      email: "Operator@Example.COM",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$abc$def",
      createdAt: "2026-08-14T00:00:00.000Z",
    });
    expect(parsed.email).toBe("operator@example.com");
  });
});

describe("phase 2 schema additions", () => {
  const baseAccount = {
    id: "acct-1",
    name: "Studio Nord",
    igUserId: "1784140",
    username: "studionord",
    status: "ACTIVE",
    accessTokenEncrypted: "v1:a:b:c",
    tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };

  it("defaults timezone to UTC and gives three posting windows", () => {
    const parsed = AccountSchema.parse(baseAccount);
    expect(parsed.timezone).toBe("UTC");
    expect(parsed.postingWindows).toEqual(["09:00", "12:30", "18:00"]);
  });

  it("accepts an explicit voice, timezone and windows", () => {
    const parsed = AccountSchema.parse({
      ...baseAccount,
      voice: "warm, plain",
      timezone: "Europe/Berlin",
      postingWindows: ["08:00"],
    });
    expect(parsed.timezone).toBe("Europe/Berlin");
    expect(parsed.postingWindows).toEqual(["08:00"]);
  });

  it("rejects a malformed posting window", () => {
    expect(() => AccountSchema.parse({ ...baseAccount, postingWindows: ["9am"] })).toThrow();
  });

  it("accepts the new optional post fields", () => {
    const parsed = PostSchema.parse({
      id: "p1",
      accountId: "acct-1",
      status: "PENDING_APPROVAL",
      format: "IMAGE",
      version: 1,
      mediaAssetIds: ["a1"],
      caption: "",
      hashtags: [],
      scheduledAt: "2026-08-16T09:00:00.000Z",
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      needsAttention: true,
      altText: "A studio at dawn",
      dryRun: true,
    });
    expect(parsed.needsAttention).toBe(true);
    expect(parsed.altText).toBe("A studio at dawn");
  });

  it("accepts draftFailed on a media asset", () => {
    const parsed = MediaAssetSchema.parse({
      id: "a1",
      accountId: "acct-1",
      storageKey: "acct-1/a1.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      createdAt: "2026-08-15T00:00:00.000Z",
      draftFailed: true,
    });
    expect(parsed.draftFailed).toBe(true);
  });
});
