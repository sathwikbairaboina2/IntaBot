import { z } from "zod";

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes",
  });

/**
 * `node --env-file=.env` sets a declared-but-blank key to "" rather than
 * leaving it undefined, so a freshly copied .env.example would otherwise
 * fail every optional variable's min(1) check. Blank means absent.
 */
const optionalString = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  AWS_REGION: z.string().min(1),
  DYNAMO_ENDPOINT: optionalString(z.string().url()),
  DYNAMO_TABLE_MAIN: z.string().min(1),
  DYNAMO_TABLE_CHECKPOINTS: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: base64Key32,
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  META_APP_ID: optionalString(z.string().min(1)),
  META_APP_SECRET: optionalString(z.string().min(1)),
  META_WEBHOOK_VERIFY_TOKEN: optionalString(z.string().min(1)),
  ANTHROPIC_API_KEY: optionalString(z.string().min(1)),
  INSTAGRAM_MODE: z.enum(["fake", "live"]).default("fake"),
  /**
   * Which implementation backs the three model roles. Unset keeps the original
   * behaviour: a key means Anthropic, no key means the deterministic fakes.
   */
  LLM_PROVIDER: optionalString(z.enum(["fake", "anthropic", "ollama"])),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3.8:27b"),
  /** Shared secret for Studio's job-card handoff. Unset disables the endpoint. */
  HANDOFF_KEY: optionalString(z.string().min(1)),
  /** Account that handoff posts land on when the request names none. */
  HANDOFF_ACCOUNT_ID: optionalString(z.string().min(1)),
  /** Redis key prefix for queues; a second local instance needs its own. */
  QUEUE_PREFIX: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).default("intabot")),
  PUBLISH_SCAN_INTERVAL_MS: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().default(60_000),
  ),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  dynamo: { region: string; endpoint?: string; tableMain: string; tableCheckpoints: string };
  redisUrl: string;
  s3: { endpoint: string; bucket: string; accessKey: string; secretKey: string };
  tokenEncryptionKey: Buffer;
  session: { ttlHours: number };
  meta: { appId?: string; appSecret?: string; webhookVerifyToken?: string };
  /** Optional: when absent the deterministic FakeCopyWriter is used. */
  anthropicApiKey?: string;
  /** "live" swaps FakeInstagramAdapter for the real Graph adapter. */
  instagramMode: "fake" | "live";
  /** Resolved implementation for the copy writer, classifier and reply writer. */
  llmProvider: "fake" | "anthropic" | "ollama";
  ollama: { baseUrl: string; model: string };
  handoff: { key?: string; accountId?: string };
  queuePrefix: string;
  /** How often the publish scan looks for approved posts that are due. */
  publishScanIntervalMs: number;
}

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    dynamo: {
      region: e.AWS_REGION,
      endpoint: e.DYNAMO_ENDPOINT,
      tableMain: e.DYNAMO_TABLE_MAIN,
      tableCheckpoints: e.DYNAMO_TABLE_CHECKPOINTS,
    },
    redisUrl: e.REDIS_URL,
    s3: {
      endpoint: e.S3_ENDPOINT,
      bucket: e.S3_BUCKET,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
    },
    tokenEncryptionKey: Buffer.from(e.TOKEN_ENCRYPTION_KEY, "base64"),
    session: { ttlHours: e.SESSION_TTL_HOURS },
    meta: {
      appId: e.META_APP_ID,
      appSecret: e.META_APP_SECRET,
      webhookVerifyToken: e.META_WEBHOOK_VERIFY_TOKEN,
    },
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    instagramMode: e.INSTAGRAM_MODE,
    // An explicit provider wins; otherwise the pre-existing rule stands, so a
    // checkout that never heard of LLM_PROVIDER behaves exactly as before.
    llmProvider: e.LLM_PROVIDER ?? (e.ANTHROPIC_API_KEY ? "anthropic" : "fake"),
    ollama: { baseUrl: e.OLLAMA_BASE_URL, model: e.OLLAMA_MODEL },
    handoff: { key: e.HANDOFF_KEY, accountId: e.HANDOFF_ACCOUNT_ID },
    queuePrefix: e.QUEUE_PREFIX,
    publishScanIntervalMs: e.PUBLISH_SCAN_INTERVAL_MS,
  };
}
