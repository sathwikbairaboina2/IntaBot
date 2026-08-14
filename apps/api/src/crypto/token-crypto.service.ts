import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

export const TOKEN_ENCRYPTION_KEY = Symbol("TOKEN_ENCRYPTION_KEY");

const VERSION = "v1";
const IV_BYTES = 12;

@Injectable()
export class TokenCryptoService {
  constructor(@Inject(TOKEN_ENCRYPTION_KEY) private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("token encryption key must be 32 bytes");
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");
  }

  decrypt(payload: string): string {
    const parts = payload.split(":");
    if (parts.length !== 4) throw new Error("malformed encrypted payload");
    const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
    if (version !== VERSION) throw new Error(`unsupported payload version: ${version}`);

    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
