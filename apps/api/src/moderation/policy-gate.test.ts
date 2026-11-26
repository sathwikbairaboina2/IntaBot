import { describe, expect, it } from "vitest";
import type { Account, Classification } from "@intabot/shared";
import { policyGate, type GateInput } from "./policy-gate";

const account = {
  id: "acct-1",
  name: "Studio Nord",
  igUserId: "1784140",
  username: "studionord",
  status: "ACTIVE",
  accessTokenEncrypted: "v1:a:b:c",
  tokenExpiresAt: "2026-10-13T00:00:00.000Z",
  dryRun: true,
  moderationPaused: false,
  timezone: "UTC",
  postingWindows: ["09:00"],
  replyCapPerPostPerHour: 4,
  replyCapPerAccountPerHour: 20,
  blocklist: ["refund"],
  linkKeyword: "LINK",
  listKeyword: "LIST",
  listText: null,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
} satisfies Account;

const praise: Classification = {
  sentiment: "positive",
  intent: "praise",
  toxicity: 0,
  isSpam: false,
  needsHuman: false,
};

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    account,
    fromIgUserId: "9900112",
    commentText: "Love this!",
    classification: praise,
    postCapReached: false,
    accountCapReached: false,
    ...over,
  };
}

describe("policyGate", () => {
  it("replies by default", () => {
    expect(policyGate(input())).toEqual({ action: "reply", rule: "default" });
  });

  it("ignores the account's own comment before anything else", () => {
    const verdict = policyGate(
      input({
        fromIgUserId: account.igUserId,
        classification: null,
        commentText: "refund",
      }),
    );
    expect(verdict).toEqual({ action: "ignore", rule: "self-reply-guard" });
  });

  it("ignores when moderation is paused, even for a reply-worthy comment", () => {
    const verdict = policyGate(input({ account: { ...account, moderationPaused: true } }));
    expect(verdict).toEqual({ action: "ignore", rule: "paused" });
  });

  it("escalates a blocklisted term case-insensitively, beating needsHuman", () => {
    const verdict = policyGate(
      input({
        commentText: "I want a REFUND now",
        classification: { ...praise, needsHuman: true },
      }),
    );
    expect(verdict).toEqual({ action: "escalate", rule: "blocklist" });
  });

  it("escalates needsHuman", () => {
    const verdict = policyGate(input({ classification: { ...praise, needsHuman: true } }));
    expect(verdict).toEqual({ action: "escalate", rule: "needs-human" });
  });

  it("ignores spam", () => {
    const verdict = policyGate(
      input({ classification: { ...praise, intent: "spam", isSpam: true } }),
    );
    expect(verdict).toEqual({ action: "ignore", rule: "spam" });
  });

  it("escalates rather than ignores when a cap is reached", () => {
    expect(policyGate(input({ postCapReached: true }))).toEqual({
      action: "escalate",
      rule: "cap-exceeded",
    });
    expect(policyGate(input({ accountCapReached: true }))).toEqual({
      action: "escalate",
      rule: "cap-exceeded",
    });
  });

  it("treats a missing classification as escalation", () => {
    expect(policyGate(input({ classification: null }))).toEqual({
      action: "escalate",
      rule: "unclassified",
    });
  });
});
