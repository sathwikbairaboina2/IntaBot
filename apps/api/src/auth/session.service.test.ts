import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { SessionService } from "./session.service";

const svc = new SessionService(docClient, tableMain, 168);

describe("SessionService", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("issues an opaque token", async () => {
    const { token } = await svc.create("operator@example.com");
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("verifies a token it issued", async () => {
    const { token } = await svc.create("operator@example.com");
    expect(await svc.verify(token)).toBe("operator@example.com");
  });

  it("returns null for an unknown token", async () => {
    expect(await svc.verify("0".repeat(64))).toBeNull();
  });

  it("returns null after revocation", async () => {
    const { token } = await svc.create("operator@example.com");
    await svc.revoke(token);
    expect(await svc.verify(token)).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const expiring = new SessionService(docClient, tableMain, -1);
    const { token } = await expiring.create("operator@example.com");
    expect(await expiring.verify(token)).toBeNull();
  });

  it("stores only a hash of the token, never the token itself", async () => {
    const { token } = await svc.create("operator@example.com");
    const out = await docClient.send(new ScanCommand({ TableName: tableMain }));
    expect(JSON.stringify(out.Items)).not.toContain(token);
  });
});
