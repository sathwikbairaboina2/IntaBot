import { describe, expect, it } from "vitest";
import {
  AccountSchema,
  CommentSchema,
  IanaTimezone,
  MediaAssetSchema,
  PostingWindows,
  PostSchema,
  UserSchema,
} from "../index.js";

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

  it("accepts draftFailed on a media asset (phase 2)", () => {
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

describe("phase 3 schema additions", () => {
  const comment = {
    igCommentId: "1790001",
    accountId: "acct-1",
    postId: "post-1",
    igMediaId: "fake-media-9",
    text: "Love this!",
    fromIgUserId: "9900112",
    fromUsername: "happyfan",
    status: "RECEIVED",
    version: 1,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };

  it("parses a valid received comment", () => {
    const parsed = CommentSchema.parse(comment);
    expect(parsed.status).toBe("RECEIVED");
    expect(parsed.classification).toBeUndefined();
  });

  it("parses an auto-replied comment with its classification", () => {
    const parsed = CommentSchema.parse({
      ...comment,
      status: "AUTO_REPLIED",
      version: 3,
      classification: {
        sentiment: "positive",
        intent: "praise",
        toxicity: 0.02,
        isSpam: false,
        needsHuman: false,
      },
      policyRule: "default",
      replyText: "Thanks!",
      replyId: "fake-reply-1",
    });
    expect(parsed.classification?.intent).toBe("praise");
    expect(parsed.replyId).toBe("fake-reply-1");
  });

  it("parses a link-request comment with its DM fields", () => {
    const parsed = CommentSchema.parse({
      ...comment,
      status: "AUTO_REPLIED",
      version: 3,
      policyRule: "link-request",
      replyText: "Sent you the link in your DMs.",
      replyId: "fake-reply-1",
      dmText: "Here is the apply link: https://aiiolar.com/jobs?job=a",
      dmId: "fake-dm-1",
    });
    expect(parsed.policyRule).toBe("link-request");
    expect(parsed.dmId).toBe("fake-dm-1");
    expect(CommentSchema.parse(comment).dmText).toBeUndefined();
  });

  it("rejects an unknown comment status", () => {
    expect(() => CommentSchema.parse({ ...comment, status: "REPLIED" })).toThrow();
  });

  it("rejects toxicity outside 0..1", () => {
    expect(() =>
      CommentSchema.parse({
        ...comment,
        classification: {
          sentiment: "negative",
          intent: "complaint",
          toxicity: 1.2,
          isSpam: false,
          needsHuman: true,
        },
      }),
    ).toThrow();
  });

  it("defaults account moderation policy fields", () => {
    const parsed = AccountSchema.parse({
      id: "acct-1",
      name: "Studio Nord",
      igUserId: "1784140",
      username: "studionord",
      status: "ACTIVE",
      accessTokenEncrypted: "v1:a:b:c",
      tokenExpiresAt: "2026-10-13T00:00:00.000Z",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(parsed.replyCapPerPostPerHour).toBe(4);
    expect(parsed.replyCapPerAccountPerHour).toBe(20);
    expect(parsed.blocklist).toEqual([]);
  });

  it("accepts explicit policy fields and rejects a zero cap", () => {
    const base = {
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
    const parsed = AccountSchema.parse({
      ...base,
      replyCapPerPostPerHour: 2,
      blocklist: ["refund", "lawsuit"],
    });
    expect(parsed.replyCapPerPostPerHour).toBe(2);
    expect(parsed.blocklist).toContain("lawsuit");
    expect(() => AccountSchema.parse({ ...base, replyCapPerAccountPerHour: 0 })).toThrow();
  });
});

describe("handoff schema additions", () => {
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
  const basePost = {
    id: "post-1",
    accountId: "acct-1",
    status: "PENDING_APPROVAL",
    format: "IMAGE",
    version: 1,
    mediaAssetIds: ["asset-1"],
    caption: "Hiring.",
    hashtags: [],
    scheduledAt: "2026-08-15T09:00:00.000Z",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };

  it("defaults linkKeyword to LINK", () => {
    expect(AccountSchema.parse(baseAccount).linkKeyword).toBe("LINK");
  });

  it("keeps an explicit linkKeyword and rejects an empty one", () => {
    expect(AccountSchema.parse({ ...baseAccount, linkKeyword: "APPLY" }).linkKeyword).toBe("APPLY");
    expect(() => AccountSchema.parse({ ...baseAccount, linkKeyword: "" })).toThrow();
  });

  it("leaves applyUrl and source undefined on an older post", () => {
    const parsed = PostSchema.parse(basePost);
    expect(parsed.applyUrl).toBeUndefined();
    expect(parsed.source).toBeUndefined();
  });

  it("accepts applyUrl and source and rejects a non-url applyUrl", () => {
    const parsed = PostSchema.parse({
      ...basePost,
      applyUrl: "https://aiiolar.com/jobs?job=abc",
      source: { app: "iolar-studio", ref: "card-1" },
    });
    expect(parsed.source).toEqual({ app: "iolar-studio", ref: "card-1" });
    expect(() => PostSchema.parse({ ...basePost, applyUrl: "not a url" })).toThrow();
  });
});

describe("control room schema additions", () => {
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
  const basePost = {
    id: "post-1",
    accountId: "acct-1",
    status: "PENDING_APPROVAL",
    format: "CAROUSEL",
    version: 1,
    mediaAssetIds: ["asset-1", "asset-2"],
    caption: "Hiring.",
    hashtags: [],
    scheduledAt: "2026-08-15T09:00:00.000Z",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };

  it("defaults listKeyword to LIST and listText to null", () => {
    const parsed = AccountSchema.parse(baseAccount);
    expect(parsed.listKeyword).toBe("LIST");
    expect(parsed.listText).toBeNull();
  });

  it("keeps an explicit listText and caps it at 1000 characters", () => {
    expect(AccountSchema.parse({ ...baseAccount, listText: "all jobs: x" }).listText).toBe(
      "all jobs: x",
    );
    expect(() => AccountSchema.parse({ ...baseAccount, listText: "x".repeat(1001) })).toThrow();
    expect(() => AccountSchema.parse({ ...baseAccount, listKeyword: "" })).toThrow();
  });

  it("accepts a post keyword and child containers", () => {
    const parsed = PostSchema.parse({
      ...basePost,
      keyword: "ZOHO",
      childContainerIds: ["c1", "c2"],
    });
    expect(parsed.keyword).toBe("ZOHO");
    expect(parsed.childContainerIds).toEqual(["c1", "c2"]);
    expect(PostSchema.parse(basePost).keyword).toBeUndefined();
  });

  it("accepts hidden and deleted flags on a comment", () => {
    const parsed = CommentSchema.parse({
      igCommentId: "c-1",
      accountId: "acct-1",
      postId: "post-1",
      igMediaId: "m-1",
      text: "hi",
      fromIgUserId: "u-1",
      fromUsername: "someone",
      status: "RECEIVED",
      version: 1,
      hidden: true,
      deleted: false,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(parsed.hidden).toBe(true);
    expect(parsed.deleted).toBe(false);
  });
});

describe("launch fix schema additions", () => {
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
  const baseComment = {
    igCommentId: "c1",
    accountId: "acct-1",
    postId: "p1",
    igMediaId: "m1",
    text: "LINK",
    fromIgUserId: "u1",
    fromUsername: "someone",
    status: "AUTO_REPLIED",
    version: 1,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };

  it("validates IANA zones and posting windows", () => {
    expect(IanaTimezone.safeParse("Asia/Kolkata").success).toBe(true);
    expect(IanaTimezone.safeParse("UTC").success).toBe(true);
    expect(IanaTimezone.safeParse("Mars/Olympus").success).toBe(false);
    expect(IanaTimezone.safeParse("").success).toBe(false);

    expect(PostingWindows.parse(["18:00", "09:00"])).toEqual(["09:00", "18:00"]);
    expect(PostingWindows.safeParse([]).success).toBe(false);
    expect(PostingWindows.safeParse(["09:00", "09:00"]).success).toBe(false);
    expect(PostingWindows.safeParse(["9:00"]).success).toBe(false);
    expect(PostingWindows.safeParse(["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"]).success).toBe(false);
  });

  it("keeps the refresh error optional and nullable on an account", () => {
    expect(AccountSchema.parse(baseAccount).tokenRefreshError).toBeUndefined();
    expect(AccountSchema.parse({ ...baseAccount, tokenRefreshError: null }).tokenRefreshError).toBeNull();
    expect(AccountSchema.parse({ ...baseAccount, tokenRefreshError: "graph 190: x" }).tokenRefreshError).toBe("graph 190: x");
  });

  it("records the DM state, its error and a failure reason on a comment", () => {
    const parsed = CommentSchema.parse({
      ...baseComment,
      dmState: "failed",
      dmError: "graph 10: no permission",
      failureReason: "graph 4: rate limit",
    });
    expect(parsed.dmState).toBe("failed");
    expect(CommentSchema.parse(baseComment).dmState).toBeUndefined();
    expect(() => CommentSchema.parse({ ...baseComment, dmState: "maybe" })).toThrow();
    for (const state of ["sent", "failed", "skipped"]) {
      expect(CommentSchema.parse({ ...baseComment, dmState: state }).dmState).toBe(state);
    }
  });
});
