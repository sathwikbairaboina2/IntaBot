import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import { FakeInstagramAdapter } from "../instagram/fake-instagram.adapter";
import { GraphError } from "../instagram/graph-responses";
import type { InstagramPort, RefreshedToken } from "../instagram/instagram.port";
import { MemoryAccounts, MemoryAudit, makeAccount } from "../../test/memory-stubs";
import { TokenRefreshProcessor } from "./token-refresh.processor";

const crypto = new TokenCryptoService(Buffer.alloc(32, 5));
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY + 60_000).toISOString();

class RecordingInstagram extends FakeInstagramAdapter {
  refreshCalls: Account[] = [];
  outcome: RefreshedToken | Error = { accessToken: "FRESH-TOKEN", expiresInSeconds: 60 * 86_400 };
  override async refreshAccessToken(account: Account): Promise<RefreshedToken> {
    this.refreshCalls.push(account);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

describe("TokenRefreshProcessor", () => {
  let ig: RecordingInstagram;
  let accounts: MemoryAccounts;
  let audit: MemoryAudit;

  function build(mode: "live" | "fake", list: Account[]) {
    ig = new RecordingInstagram();
    accounts = new MemoryAccounts(list);
    audit = new MemoryAudit();
    return new TokenRefreshProcessor(
      accounts as never,
      ig as InstagramPort,
      crypto,
      audit as never,
      { instagramMode: mode } as never,
    );
  }

  const live = (over: Record<string, unknown> = {}) =>
    makeAccount({
      dryRun: false,
      accessTokenEncrypted: crypto.encrypt("OLD-TOKEN"),
      tokenExpiresAt: inDays(10),
      ...over,
    });

  it("never calls Instagram in fake mode, whatever the account looks like", async () => {
    const p = build("fake", [live({ tokenExpiresAt: inDays(1) })]);
    expect(await p.process()).toEqual({ refreshed: 0, failed: 0, skipped: 1 });
    expect(ig.refreshCalls).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("never refreshes an account in dry run, even in live mode", async () => {
    const p = build("live", [live({ dryRun: true, tokenExpiresAt: inDays(1) })]);
    expect(await p.process()).toEqual({ refreshed: 0, failed: 0, skipped: 1 });
    expect(ig.refreshCalls).toHaveLength(0);
  });

  it("leaves a token with 15 or more days alone", async () => {
    const p = build("live", [live({ tokenExpiresAt: inDays(15) })]);
    expect((await p.process()).skipped).toBe(1);
    expect(ig.refreshCalls).toHaveLength(0);
  });

  it("skips accounts that are not ACTIVE", async () => {
    const p = build("live", [live({ status: "DISABLED" })]);
    expect((await p.process()).skipped).toBe(1);
    expect(ig.refreshCalls).toHaveLength(0);
  });

  it("refreshes a token with fewer than 15 days, storing it encrypted with the new expiry", async () => {
    const p = build("live", [live({ tokenRefreshError: "graph 190: old failure" })]);
    expect(await p.process()).toEqual({ refreshed: 1, failed: 0, skipped: 0 });

    expect(crypto.decrypt(ig.refreshCalls[0]!.accessTokenEncrypted)).toBe("OLD-TOKEN");
    const stored = (await accounts.get("acct-1"))!;
    expect(stored.accessTokenEncrypted).not.toContain("FRESH-TOKEN");
    expect(crypto.decrypt(stored.accessTokenEncrypted)).toBe("FRESH-TOKEN");
    const days = (new Date(stored.tokenExpiresAt).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThan(60.1);
    expect(stored.tokenRefreshError).toBeNull();
    expect(stored.tokenRefreshedAt).toBeDefined();
    expect(audit.entries).toEqual([
      expect.objectContaining({ actor: "system", action: "token.refresh", accountId: "acct-1" }),
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain("FRESH-TOKEN");
  });

  it("records the failure on the account and keeps the old token", async () => {
    const p = build("live", [live()]);
    ig.outcome = new GraphError(190, "Cannot refresh an expired token", { status: 400 });
    expect(await p.process()).toEqual({ refreshed: 0, failed: 1, skipped: 0 });

    const stored = (await accounts.get("acct-1"))!;
    expect(stored.tokenRefreshError).toBe("graph 190: Cannot refresh an expired token");
    expect(crypto.decrypt(stored.accessTokenEncrypted)).toBe("OLD-TOKEN");
    expect(audit.entries[0]).toMatchObject({ actor: "system", action: "token.refresh-failed" });
  });

  it("one failing account does not stop the next", async () => {
    const p = build("live", [
      live({ id: "a", igUserId: "1" }),
      live({ id: "b", igUserId: "2", name: "Second" }),
    ]);
    let n = 0;
    ig.refreshAccessToken = async (account) => {
      ig.refreshCalls.push(account);
      if (n++ === 0) throw new GraphError(1, "boom", { status: 500 });
      return { accessToken: "FRESH-TOKEN", expiresInSeconds: 5_184_000 };
    };
    expect(await p.process()).toEqual({ refreshed: 1, failed: 1, skipped: 0 });
  });
});
