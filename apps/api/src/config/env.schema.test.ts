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

  // `node --env-file=.env` sets declared-but-blank keys to "", not undefined,
  // so a freshly copied .env.example must still parse.
  it("treats a blank optional variable as absent", () => {
    const cfg = parseEnv({
      ...valid,
      META_APP_ID: "",
      META_APP_SECRET: "",
      META_WEBHOOK_VERIFY_TOKEN: "",
      DYNAMO_ENDPOINT: "",
    });
    expect(cfg.meta.appId).toBeUndefined();
    expect(cfg.meta.appSecret).toBeUndefined();
    expect(cfg.dynamo.endpoint).toBeUndefined();
  });

  it("defaults the handoff and runtime knobs", () => {
    const cfg = parseEnv(valid);
    expect(cfg.handoff.key).toBeUndefined();
    expect(cfg.handoff.accountId).toBeUndefined();
    expect(cfg.queuePrefix).toBe("intabot");
    expect(cfg.publishScanIntervalMs).toBe(60000);
  });

  it("reads the handoff and runtime knobs and treats blanks as absent", () => {
    const cfg = parseEnv({
      ...valid,
      HANDOFF_KEY: "k",
      HANDOFF_ACCOUNT_ID: "acct-1",
      QUEUE_PREFIX: "intabot-e2e",
      PUBLISH_SCAN_INTERVAL_MS: "2000",
    });
    expect(cfg.handoff).toEqual({ key: "k", accountId: "acct-1" });
    expect(cfg.queuePrefix).toBe("intabot-e2e");
    expect(cfg.publishScanIntervalMs).toBe(2000);

    const blank = parseEnv({ ...valid, HANDOFF_KEY: "", HANDOFF_ACCOUNT_ID: "", QUEUE_PREFIX: "" });
    expect(blank.handoff.key).toBeUndefined();
    expect(blank.queuePrefix).toBe("intabot");
  });
});
