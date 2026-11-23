import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTables } from "../../test/dynamo-fixture";

const apiRoot = resolve(__dirname, "../..");

function run(args: string[]): Promise<{ code: number | null; stdout: string; timedOut: boolean }> {
  return new Promise((resolveRun) => {
    const child = execFile(
      process.execPath,
      ["--import", "tsx", "src/cli/create-user.ts", ...args],
      { cwd: apiRoot, env: process.env, timeout: 40_000 },
      (error, stdout) => {
        const timedOut = Boolean(error && "killed" in error && error.killed);
        resolveRun({ code: child.exitCode, stdout, timedOut });
      },
    );
  });
}

describe("create-user CLI", () => {
  beforeAll(async () => {
    await resetTables();
  });
  afterAll(async () => {
    await resetTables();
  });

  it("exits 0 by itself after creating the operator", async () => {
    const result = await run(["cli-op@example.com", "pw-1234"]);
    expect(result.stdout).toContain("created operator: cli-op@example.com");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  }, 60_000);
});
