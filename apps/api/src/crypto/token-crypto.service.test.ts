import { describe, expect, it } from "vitest";
import { TokenCryptoService } from "./token-crypto.service";

const key = Buffer.alloc(32, 9);
const svc = new TokenCryptoService(key);

describe("TokenCryptoService", () => {
  it("round-trips a token", () => {
    const token = "IGQVJ...long-lived-token";
    expect(svc.decrypt(svc.encrypt(token))).toBe(token);
  });

  it("produces a versioned four-part payload", () => {
    expect(svc.encrypt("x").split(":")).toHaveLength(4);
    expect(svc.encrypt("x").startsWith("v1:")).toBe(true);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(svc.encrypt("same")).not.toBe(svc.encrypt("same"));
  });

  it("never contains the plaintext", () => {
    expect(svc.encrypt("SECRET_TOKEN")).not.toContain("SECRET_TOKEN");
  });

  it("rejects a tampered ciphertext", () => {
    const [v, iv, tag, ct] = svc.encrypt("hello").split(":");
    const flipped = Buffer.from(ct!, "base64");
    flipped[0] ^= 0xff;
    expect(() => svc.decrypt(`${v}:${iv}:${tag}:${flipped.toString("base64")}`)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const [v, iv, , ct] = svc.encrypt("hello").split(":");
    expect(() => svc.decrypt(`${v}:${iv}:${Buffer.alloc(16).toString("base64")}:${ct}`)).toThrow();
  });

  it("rejects an unknown version prefix", () => {
    const parts = svc.encrypt("hello").split(":");
    expect(() => svc.decrypt(["v9", ...parts.slice(1)].join(":"))).toThrow(/version/i);
  });

  it("cannot be decrypted with a different key", () => {
    const other = new TokenCryptoService(Buffer.alloc(32, 1));
    expect(() => other.decrypt(svc.encrypt("hello"))).toThrow();
  });
});
