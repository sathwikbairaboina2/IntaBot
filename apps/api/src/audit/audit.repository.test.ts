import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { AuditRepository } from "./audit.repository";

const repo = new AuditRepository(docClient, tableMain);

describe("AuditRepository", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("appends entries and lists them in order", async () => {
    await repo.append({
      accountId: "acct-1",
      actor: "agent",
      action: "AUTO_REPLIED",
      rule: "default",
      igCommentId: "c1",
      postId: "p1",
      classificationSummary: "praise/positive",
    });
    await repo.append({
      accountId: "acct-1",
      actor: "human",
      action: "HUMAN_REPLIED",
      igCommentId: "c2",
      postId: "p1",
    });

    const entries = await repo.list("acct-1");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ actor: "agent", action: "AUTO_REPLIED", rule: "default" });
    expect(entries[1]).toMatchObject({ actor: "human", action: "HUMAN_REPLIED" });
  });

  it("stamps a ttl roughly 90 days out", async () => {
    await repo.append({ accountId: "acct-1", actor: "system", action: "test" });
    const [entry] = await repo.list("acct-1");
    const ttl = entry!.ttl as number;
    const ninetyDays = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
    expect(Math.abs(ttl - ninetyDays)).toBeLessThan(60);
  });

  it("flags dry-run entries", async () => {
    await repo.append({ accountId: "acct-1", actor: "agent", action: "AUTO_REPLIED", dryRun: true });
    const [entry] = await repo.list("acct-1");
    expect(entry!.dryRun).toBe(true);
  });
});
