import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { AccountAlreadyExistsError, AccountRepository } from "./account.repository";

const repo = new AccountRepository(docClient, tableMain);

const input = {
  name: "Studio Nord",
  igUserId: "17841400000000000",
  username: "studionord",
  accessTokenEncrypted: "v1:a:b:c",
  tokenExpiresAt: "2026-10-13T00:00:00.000Z",
};

describe("AccountRepository", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("creates an account with a generated id and ACTIVE status", async () => {
    const account = await repo.create(input);
    expect(account.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(account.status).toBe("ACTIVE");
    expect(account.dryRun).toBe(true);
  });

  it("reads back an account it created", async () => {
    const created = await repo.create(input);
    const found = await repo.get(created.id);
    expect(found?.username).toBe("studionord");
  });

  it("returns null for an unknown account", async () => {
    expect(await repo.get("nope")).toBeNull();
  });

  it("rejects a duplicate id", async () => {
    await repo.create({ ...input, id: "fixed-id" });
    await expect(repo.create({ ...input, id: "fixed-id" })).rejects.toBeInstanceOf(
      AccountAlreadyExistsError,
    );
  });

  it("lists accounts ordered by name", async () => {
    await repo.create({ ...input, id: "b", name: "Zebra Co" });
    await repo.create({ ...input, id: "a", name: "Alpha Co" });
    const listed = await repo.list();
    expect(listed.map((a) => a.name)).toEqual(["Alpha Co", "Zebra Co"]);
  });

  it("updates status and bumps updatedAt", async () => {
    const created = await repo.create(input);
    const updated = await repo.update(created.id, { status: "DEGRADED" });
    expect(updated.status).toBe("DEGRADED");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it("defaults linkKeyword to LINK and updates it", async () => {
    const created = await repo.create(input);
    expect(created.linkKeyword).toBe("LINK");
    const updated = await repo.update(created.id, { linkKeyword: "APPLY" });
    expect(updated.linkKeyword).toBe("APPLY");
  });

  it("keeps the GSI1SK in sync when the name changes", async () => {
    const created = await repo.create(input);
    await repo.update(created.id, { name: "Aardvark Co" });
    const listed = await repo.list();
    expect(listed[0]?.name).toBe("Aardvark Co");
  });
});
