import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.schema";

const valid = {
  NODE_ENV: "test",
  PORT: "3001",
  AWS_REGION: "us-east-1",
  DYNAMO_ENDPOINT: "http://localhost:8200",
  DYNAMO_TABLE_MAIN: "intabot_main",
  DYNAMO_TABLE_CHECKPOINTS: "intabot_checkpoints",
  REDIS_URL: "redis://localhost:6479",
  S3_ENDPOINT: "http://localhost:9200",
  S3_BUCKET: "intabot-media",
  S3_ACCESS_KEY: "intabot",
  S3_SECRET_KEY: "secret",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SESSION_TTL_HOURS: "168",
};

describe("parseEnv", () => {
  it("parses a valid environment and coerces numbers", () => {
    const cfg = parseEnv(valid);
    expect(cfg.port).toBe(3001);
    expect(cfg.session.ttlHours).toBe(168);
    expect(cfg.dynamo.tableMain).toBe("intabot_main");
  });

  it("rejects a TOKEN_ENCRYPTION_KEY that is not 32 bytes", () => {
    expect(() => parseEnv({ ...valid, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }))
      .toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("names every missing variable in the error message", () => {
    expect(() => parseEnv({ NODE_ENV: "test" })).toThrow(/DYNAMO_TABLE_MAIN/);
  });

  it("allows Meta credentials to be absent in phase 1", () => {
    expect(parseEnv(valid).meta.appId).toBeUndefined();
  });
});
