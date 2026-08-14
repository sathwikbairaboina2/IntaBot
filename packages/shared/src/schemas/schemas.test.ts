import { describe, expect, it } from "vitest";
import { AccountSchema, PostSchema, UserSchema } from "../index.js";

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
