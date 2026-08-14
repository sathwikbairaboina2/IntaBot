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
  };
}
