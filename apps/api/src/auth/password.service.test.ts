import { describe, expect, it } from "vitest";
import { PasswordService } from "./password.service";

const svc = new PasswordService();

describe("PasswordService", () => {
  it("produces an argon2id hash", async () => {
    const hash = await svc.hash("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies the correct password", async () => {
    const hash = await svc.hash("s3cret");
    expect(await svc.verify(hash, "s3cret")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await svc.hash("s3cret");
    expect(await svc.verify(hash, "wrong")).toBe(false);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    expect(await svc.verify("not-a-hash", "s3cret")).toBe(false);
  });

  it("salts, so the same password hashes differently", async () => {
    expect(await svc.hash("same")).not.toBe(await svc.hash("same"));
  });
});
