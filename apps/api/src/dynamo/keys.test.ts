import { describe, expect, it } from "vitest";
import { keys } from "./keys";

describe("keys", () => {
  it("builds account keys", () => {
    expect(keys.account("a1")).toEqual({ PK: "ACCT#a1", SK: "#META" });
  });

  it("builds the account list index key", () => {
    expect(keys.accountListIndex("Studio Nord")).toEqual({
      GSI1PK: "TYPE#ACCOUNT",
      GSI1SK: "Studio Nord",
    });
  });

  it("builds post keys", () => {
    expect(keys.post("a1", "p1")).toEqual({ PK: "ACCT#a1", SK: "POST#p1" });
  });

  it("builds the post status index key", () => {
    expect(keys.postStatusIndex("a1", "PENDING_APPROVAL", "2026-08-15T09:00:00.000Z")).toEqual({
      GSI1PK: "ACCT#a1#ST#PENDING_APPROVAL",
      GSI1SK: "2026-08-15T09:00:00.000Z",
    });
  });

  it("builds media asset keys", () => {
    expect(keys.mediaAsset("a1", "m1")).toEqual({ PK: "ACCT#a1", SK: "ASSET#m1" });
  });

  it("builds user keys with a lowercased email", () => {
    expect(keys.user("Operator@Example.com")).toEqual({
      PK: "USER#operator@example.com",
      SK: "#META",
    });
  });

  it("builds session keys from a token hash", () => {
    expect(keys.session("abc123")).toEqual({ PK: "SESSION#abc123", SK: "#" });
  });

  it("builds webhook dedupe keys", () => {
    expect(keys.webhookSeen("evt-9")).toEqual({ PK: "WH#evt-9", SK: "#" });
  });

  it("builds account insights keys", () => {
    expect(keys.accountInsights("a1", "2026-08-14")).toEqual({
      PK: "ACCT#a1#INS#ACCOUNT",
      SK: "2026-08-14",
    });
  });
});
