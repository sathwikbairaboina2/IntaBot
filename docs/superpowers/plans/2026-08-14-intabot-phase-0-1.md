# IntaBot Phases 0–1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform foundation — monorepo, local infrastructure, DynamoDB persistence with the double-publish guard, encrypted token storage, the `InstagramPort` abstraction with a working fake, operator authentication, account CRUD, and a dashboard shell — plus the manual Meta app setup that runs alongside it.

**Architecture:** pnpm monorepo with a NestJS API (`apps/api`), a Next.js dashboard (`apps/web`), and a shared zod schema package (`packages/shared`). DynamoDB single-table design accessed through thin repositories; Redis and MinIO run in the same `docker-compose` stack but are only wired up in later phases. Every Instagram call goes through the `InstagramPort` interface so Phase 1 is fully buildable and testable with zero Meta credentials.

**Tech Stack:** TypeScript 5.7, pnpm workspaces, NestJS 11, Next.js 15 (App Router), Vitest 3, `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` v3, zod 3, argon2, ulid, Docker Compose (DynamoDB Local, Redis, MinIO).

**Spec:** `docs/superpowers/specs/2026-08-14-intabot-design.md`

## Global Constraints

- **Node.js 22 LTS or newer.** `packageManager` is pinned to `pnpm@9.15.0`.
- **TypeScript strict mode everywhere.** `"strict": true`, `"noUncheckedIndexedAccess": true`.
- **All persisted entities are defined once in `packages/shared` as zod schemas.** Types are inferred with `z.infer`, never hand-written. Repositories parse on read.
- **Tokens and secrets are never logged, never returned in an API response, and never written to the audit log.** Log the account ID instead.
- **Table names come from environment variables** (`DYNAMO_TABLE_MAIN`, `DYNAMO_TABLE_CHECKPOINTS`). Never hardcoded.
- **Package names:** `@intabot/shared`, `@intabot/api`, `@intabot/web`.
- **Test runner is Vitest** in every package. Integration tests run against DynamoDB Local from the compose stack — no mocking of the AWS SDK.
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json` | Workspace and compiler configuration |
| `docker-compose.yml`, `.env.example` | Local infrastructure and environment contract |
| `packages/shared/src/schemas/*.ts` | One zod schema module per entity |
| `packages/shared/src/index.ts` | Public barrel export |
| `apps/api/src/config/config.module.ts` | Zod-validated environment configuration |
| `apps/api/src/dynamo/keys.ts` | Every DynamoDB key builder, in one place |
| `apps/api/src/dynamo/dynamo.module.ts` | DocumentClient provider |
| `apps/api/src/dynamo/bootstrap.ts` | Idempotent table creation |
| `apps/api/src/crypto/token-crypto.service.ts` | AES-256-GCM encrypt/decrypt for tokens |
| `apps/api/src/accounts/account.repository.ts` | Account persistence |
| `apps/api/src/accounts/accounts.controller.ts` | Account REST surface |
| `apps/api/src/posts/post.repository.ts` | Post persistence + conditional status transitions |
| `apps/api/src/instagram/instagram.port.ts` | The `InstagramPort` interface and its DTOs |
| `apps/api/src/instagram/fake-instagram.adapter.ts` | In-memory implementation for development and tests |
| `apps/api/src/auth/*` | Users, password hashing, sessions, guard |
| `apps/api/src/cli/create-user.ts` | Operator provisioning command |
| `apps/web/app/*` | Login page, dashboard layout, account list |
| `apps/web/lib/api.ts` | Server-side API client |

---

## Task 0: Meta app setup (human-executed, runs in parallel)

This task is manual browser work. It has no code and no tests. Do it alongside Tasks 1–12; nothing in Phase 1 is blocked by it.

**Files:**
- Create: `docs/meta-setup.md`

- [ ] **Step 1: Convert each Instagram account to a Professional account**

For every account IntaBot will manage: Instagram app → Settings → Account type and tools → Switch to professional account → choose Business or Creator.

A personal Instagram account cannot use the Graph API at all. This is a hard prerequisite.

- [ ] **Step 2: Create the Meta app**

Go to `https://developers.facebook.com/apps` → Create app → choose the use case that offers **Instagram** (currently "Other" → "Business"). Name it `IntaBot`.

- [ ] **Step 3: Add the Instagram product with Instagram Login**

In the app dashboard → Add product → **Instagram** → set up **Instagram API with Instagram Login** (the `graph.instagram.com` path, not the Facebook Login path).

- [ ] **Step 4: Record the app credentials into a local env file**

From the Instagram product settings, copy the **Instagram App ID** and **Instagram App Secret** into `.env` (created in Task 1) as `META_APP_ID` and `META_APP_SECRET`. Do not commit `.env`.

- [ ] **Step 5: Configure the OAuth redirect URI**

Add `https://<your-tunnel-host>/auth/instagram/callback` as a valid OAuth redirect URI. For local development, start a tunnel (`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) and use the hostname it prints.

- [ ] **Step 6: Add each Instagram account as an app tester**

App roles → Instagram Testers → add each account's Instagram username → accept the invitation from within each Instagram account (Settings → Apps and websites → Tester invites).

Until App Review is complete, only tester accounts can be connected. For a self-hosted tool managing accounts you control, tester status is sufficient — App Review is only needed to serve accounts you have no relationship with.

- [ ] **Step 7: Request the permissions**

In App Review → Permissions and features, request: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_insights`. In development mode with tester accounts these are usable immediately.

- [ ] **Step 8: Verify the OAuth round-trip manually**

Open the authorization URL in a browser, substituting your values:

```
https://www.instagram.com/oauth/authorize
  ?client_id=<META_APP_ID>
  &redirect_uri=<your redirect URI>
  &scope=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights
  &response_type=code
```

Approve, then exchange the returned `code` for a short-lived token:

```bash
curl -X POST https://api.instagram.com/oauth/access_token \
  -F client_id=$META_APP_ID \
  -F client_secret=$META_APP_SECRET \
  -F grant_type=authorization_code \
  -F redirect_uri=<your redirect URI> \
  -F code=<code from the redirect>
```

Then exchange for a long-lived token:

```bash
curl -G https://graph.instagram.com/access_token \
  -d grant_type=ig_exchange_token \
  -d client_secret=$META_APP_SECRET \
  -d access_token=<short-lived token>
```

- [ ] **Step 9: Confirm the token works**

```bash
curl -G https://graph.instagram.com/v23.0/me \
  -d fields=id,username,account_type \
  -d access_token=<long-lived token>
```

Expected: JSON containing `id`, `username`, and `account_type`.

- [ ] **Step 10: Write down what you actually observed**

Create `docs/meta-setup.md` recording: the exact API version string that worked (e.g. `v23.0`), the exact permission strings that were granted, the exact host (`graph.instagram.com`), the token expiry returned, and each account's `id` and `username`.

The design spec deliberately treats these as unverified. This file is the verified record that Phase 2 builds against.

- [ ] **Step 11: Commit**

```bash
git add docs/meta-setup.md
git commit -m "docs: record verified Meta app setup and API details"
```

---

## Task 1: Monorepo scaffold and local infrastructure

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml`, `vitest.workspace.ts`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/infra.smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: the workspace layout, a running compose stack, and `pnpm test` as the single test entry point

- [ ] **Step 1: Create the workspace files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`package.json`:

```json
{
  "name": "intabot",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "infra:up": "docker compose up -d",
    "infra:down": "docker compose down",
    "typecheck": "pnpm -r exec tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "5.7.2",
    "vitest": "3.0.5",
    "@types/node": "22.10.2"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

`.gitignore`:

```
node_modules/
dist/
.next/
.env
.env.local
*.log
.DS_Store
```

`vitest.workspace.ts`:

```ts
export default ["packages/*", "apps/api"];
```

- [ ] **Step 2: Create the compose stack**

`docker-compose.yml`:

```yaml
services:
  dynamodb:
    image: amazon/dynamodb-local:2.5.3
    command: ["-jar", "DynamoDBLocal.jar", "-sharedDb", "-inMemory"]
    ports: ["8000:8000"]

  redis:
    image: redis:7.4-alpine
    ports: ["6379:6379"]

  minio:
    image: minio/minio:RELEASE.2024-11-07T00-52-20Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: intabot
      MINIO_ROOT_PASSWORD: intabot-dev-secret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio-data:/data"]

volumes:
  minio-data:
```

- [ ] **Step 3: Create the environment contract**

`.env.example`:

```
NODE_ENV=development
PORT=3001

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
DYNAMO_ENDPOINT=http://localhost:8000
DYNAMO_TABLE_MAIN=intabot_main
DYNAMO_TABLE_CHECKPOINTS=intabot_checkpoints

REDIS_URL=redis://localhost:6379

S3_ENDPOINT=http://localhost:9000
S3_BUCKET=intabot-media
S3_ACCESS_KEY=intabot
S3_SECRET_KEY=intabot-dev-secret

# 32 raw bytes, base64-encoded. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
TOKEN_ENCRYPTION_KEY=

SESSION_TTL_HOURS=168

# Filled in by Task 0. Unused until Phase 2.
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
```

- [ ] **Step 4: Create the shared package skeleton**

`packages/shared/package.json`:

```json
{
  "name": "@intabot/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": { "zod": "3.24.1" }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/shared/src/index.ts`:

```ts
export const PACKAGE_NAME = "@intabot/shared";
```

- [ ] **Step 5: Write the failing infrastructure smoke test**

`packages/shared/src/infra.smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("local infrastructure", () => {
  it("has DynamoDB Local reachable on port 8000", async () => {
    const res = await fetch("http://localhost:8000", {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.0",
        "x-amz-target": "DynamoDB_20120810.ListTables",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { TableNames: string[] };
    expect(Array.isArray(body.TableNames)).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test with the stack down, to verify it fails**

Run: `pnpm install && pnpm test`
Expected: FAIL — the fetch rejects with a connection error (`ECONNREFUSED`).

- [ ] **Step 7: Start the stack and re-run**

Run: `pnpm infra:up && pnpm test`
Expected: PASS.

This proves the compose stack works before any application code depends on it.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example docker-compose.yml vitest.workspace.ts packages/shared
git commit -m "chore: scaffold pnpm monorepo and local infrastructure"
```

---

## Task 2: Shared entity schemas

**Files:**
- Create: `packages/shared/src/schemas/common.ts`
- Create: `packages/shared/src/schemas/account.ts`
- Create: `packages/shared/src/schemas/post.ts`
- Create: `packages/shared/src/schemas/media-asset.ts`
- Create: `packages/shared/src/schemas/user.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schemas/schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `AccountStatus` (`'ACTIVE' | 'DEGRADED' | 'DISABLED'`), `AccountSchema`, type `Account`
  - `PostStatus` (`'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'REJECTED'`), `PostFormat` (`'IMAGE' | 'REEL' | 'STORY' | 'CAROUSEL'`), `PostSchema`, type `Post`
  - `MediaAssetSchema`, type `MediaAsset`
  - `UserSchema`, type `User`
  - `isoDateTime`, `isoDate` zod primitives

- [ ] **Step 1: Write the failing schema tests**

`packages/shared/src/schemas/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AccountSchema, PostSchema, UserSchema } from "../index.js";

const account = {
  id: "acct-1",
  name: "Studio Nord",
  igUserId: "17841400000000000",
  username: "studionord",
  status: "ACTIVE",
  accessTokenEncrypted: "v1:aaa:bbb:ccc",
  tokenExpiresAt: "2026-10-13T00:00:00.000Z",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

describe("AccountSchema", () => {
  it("parses a valid account", () => {
    expect(AccountSchema.parse(account).status).toBe("ACTIVE");
  });

  it("rejects an unknown status", () => {
    expect(() => AccountSchema.parse({ ...account, status: "PAUSED" })).toThrow();
  });

  it("rejects a non-ISO tokenExpiresAt", () => {
    expect(() => AccountSchema.parse({ ...account, tokenExpiresAt: "next tuesday" })).toThrow();
  });
});

describe("PostSchema", () => {
  const post = {
    id: "post-1",
    accountId: "acct-1",
    status: "PENDING_APPROVAL",
    format: "REEL",
    version: 1,
    mediaAssetIds: ["asset-1"],
    caption: "Morning light.",
    hashtags: ["#studio"],
    scheduledAt: "2026-08-15T09:00:00.000Z",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };

  it("parses a valid post", () => {
    expect(PostSchema.parse(post).version).toBe(1);
  });

  it("defaults optional publish fields to undefined", () => {
    const parsed = PostSchema.parse(post);
    expect(parsed.igMediaId).toBeUndefined();
    expect(parsed.permalink).toBeUndefined();
  });

  it("rejects a negative version", () => {
    expect(() => PostSchema.parse({ ...post, version: -1 })).toThrow();
  });
});

describe("UserSchema", () => {
  it("lowercases the email", () => {
    const parsed = UserSchema.parse({
      email: "Operator@Example.COM",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$abc$def",
      createdAt: "2026-08-14T00:00:00.000Z",
    });
    expect(parsed.email).toBe("operator@example.com");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/shared/src/schemas/schemas.test.ts`
Expected: FAIL — `AccountSchema` is not exported from `../index.js`.

- [ ] **Step 3: Write the schemas**

`packages/shared/src/schemas/common.ts`:

```ts
import { z } from "zod";

export const isoDateTime = z.string().datetime();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
```

`packages/shared/src/schemas/account.ts`:

```ts
import { z } from "zod";
import { isoDateTime } from "./common.js";

export const AccountStatus = z.enum(["ACTIVE", "DEGRADED", "DISABLED"]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const AccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  igUserId: z.string().min(1),
  username: z.string().min(1),
  status: AccountStatus,
  accessTokenEncrypted: z.string().min(1),
  tokenExpiresAt: isoDateTime,
  dryRun: z.boolean().default(true),
  moderationPaused: z.boolean().default(false),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Account = z.infer<typeof AccountSchema>;
```

`packages/shared/src/schemas/post.ts`:

```ts
import { z } from "zod";
import { isoDateTime } from "./common.js";

export const PostStatus = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
]);
export type PostStatus = z.infer<typeof PostStatus>;

export const PostFormat = z.enum(["IMAGE", "REEL", "STORY", "CAROUSEL"]);
export type PostFormat = z.infer<typeof PostFormat>;

export const PostSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  status: PostStatus,
  format: PostFormat,
  version: z.number().int().nonnegative(),
  mediaAssetIds: z.array(z.string().min(1)).min(1),
  caption: z.string(),
  hashtags: z.array(z.string()),
  scheduledAt: isoDateTime,
  containerId: z.string().optional(),
  igMediaId: z.string().optional(),
  permalink: z.string().optional(),
  failureReason: z.string().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Post = z.infer<typeof PostSchema>;
```

`packages/shared/src/schemas/media-asset.ts`:

```ts
import { z } from "zod";
import { isoDateTime } from "./common.js";

export const MediaAssetSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  storageKey: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),
  createdAt: isoDateTime,
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
```

`packages/shared/src/schemas/user.ts`:

```ts
import { z } from "zod";
import { isoDateTime } from "./common.js";

export const UserSchema = z.object({
  email: z.string().email().toLowerCase(),
  passwordHash: z.string().min(1),
  createdAt: isoDateTime,
});
export type User = z.infer<typeof UserSchema>;
```

`packages/shared/src/index.ts` (replace the placeholder):

```ts
export * from "./schemas/common.js";
export * from "./schemas/account.js";
export * from "./schemas/post.js";
export * from "./schemas/media-asset.js";
export * from "./schemas/user.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/shared/src/schemas/schemas.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add zod entity schemas for account, post, media asset, user"
```

---

## Task 3: NestJS application skeleton and validated configuration

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/config.module.ts`, `apps/api/src/config/config.service.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Test: `apps/api/src/config/env.schema.test.ts`, `apps/api/test/health.e2e.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseEnv(raw: NodeJS.ProcessEnv): AppConfig` — throws a formatted error listing every invalid variable
  - `AppConfigService` with typed getters: `.dynamo`, `.session`, `.tokenEncryptionKey`, `.port`
  - `AppModule` — the root Nest module every later task imports into

- [ ] **Step 1: Create the package manifest and Nest configuration**

`apps/api/package.json`:

```json
{
  "name": "@intabot/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build"
  },
  "dependencies": {
    "@intabot/shared": "workspace:*",
    "@nestjs/common": "11.0.1",
    "@nestjs/core": "11.0.1",
    "@nestjs/platform-express": "11.0.1",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.1",
    "zod": "3.24.1"
  },
  "devDependencies": {
    "@nestjs/cli": "11.0.0",
    "@nestjs/testing": "11.0.1",
    "supertest": "7.0.0",
    "@types/supertest": "6.0.2"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "CommonJS",
    "moduleResolution": "Node"
  },
  "include": ["src", "test"]
}
```

`apps/api/nest-cli.json`:

```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

- [ ] **Step 2: Write the failing config test**

`apps/api/src/config/env.schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.schema";

const valid = {
  NODE_ENV: "test",
  PORT: "3001",
  AWS_REGION: "us-east-1",
  DYNAMO_ENDPOINT: "http://localhost:8000",
  DYNAMO_TABLE_MAIN: "intabot_main",
  DYNAMO_TABLE_CHECKPOINTS: "intabot_checkpoints",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/src/config/env.schema.test.ts`
Expected: FAIL — cannot resolve `./env.schema`.

- [ ] **Step 4: Implement the config schema**

`apps/api/src/config/env.schema.ts`:

```ts
import { z } from "zod";

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes",
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  AWS_REGION: z.string().min(1),
  DYNAMO_ENDPOINT: z.string().url().optional(),
  DYNAMO_TABLE_MAIN: z.string().min(1),
  DYNAMO_TABLE_CHECKPOINTS: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: base64Key32,
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  META_APP_ID: z.string().min(1).optional(),
  META_APP_SECRET: z.string().min(1).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
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
    s3: { endpoint: e.S3_ENDPOINT, bucket: e.S3_BUCKET, accessKey: e.S3_ACCESS_KEY, secretKey: e.S3_SECRET_KEY },
    tokenEncryptionKey: Buffer.from(e.TOKEN_ENCRYPTION_KEY, "base64"),
    session: { ttlHours: e.SESSION_TTL_HOURS },
    meta: { appId: e.META_APP_ID, appSecret: e.META_APP_SECRET, webhookVerifyToken: e.META_WEBHOOK_VERIFY_TOKEN },
  };
}
```

- [ ] **Step 5: Run the config test to verify it passes**

Run: `pnpm vitest run apps/api/src/config/env.schema.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Wire the config into a Nest module**

`apps/api/src/config/config.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { AppConfig, parseEnv } from "./env.schema";

@Injectable()
export class AppConfigService {
  private readonly config: AppConfig = parseEnv(process.env);

  get port() { return this.config.port; }
  get nodeEnv() { return this.config.nodeEnv; }
  get dynamo() { return this.config.dynamo; }
  get redisUrl() { return this.config.redisUrl; }
  get s3() { return this.config.s3; }
  get tokenEncryptionKey() { return this.config.tokenEncryptionKey; }
  get session() { return this.config.session; }
  get meta() { return this.config.meta; }
}
```

`apps/api/src/config/config.module.ts`:

```ts
import { Global, Module } from "@nestjs/common";
import { AppConfigService } from "./config.service";

@Global()
@Module({ providers: [AppConfigService], exports: [AppConfigService] })
export class AppConfigModule {}
```

- [ ] **Step 7: Write the failing health endpoint test**

`apps/api/test/health.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

describe("GET /health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it("returns ok", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/health.e2e.test.ts`
Expected: FAIL — cannot resolve `../src/app.module`.

- [ ] **Step 9: Create the app module, health controller, and bootstrap**

`apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check() { return { status: "ok" }; }
}
```

`apps/api/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config/config.module";
import { HealthController } from "./health/health.controller";

@Module({ imports: [AppConfigModule], controllers: [HealthController] })
export class AppModule {}
```

`apps/api/src/main.ts`:

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppConfigService } from "./config/config.service";

async function bootstrap() {
  // rawBody is required for Instagram webhook HMAC verification in phase 3.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(AppConfigService);
  await app.listen(config.port);
}

void bootstrap();
```

- [ ] **Step 10: Run the health test with a test environment loaded**

Create `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup-env.ts"],
    hookTimeout: 30_000,
  },
});
```

Create `apps/api/test/setup-env.ts`:

```ts
process.env.NODE_ENV = "test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "local";
process.env.AWS_SECRET_ACCESS_KEY ??= "local";
process.env.DYNAMO_ENDPOINT ??= "http://localhost:8000";
process.env.DYNAMO_TABLE_MAIN ??= "intabot_main_test";
process.env.DYNAMO_TABLE_CHECKPOINTS ??= "intabot_checkpoints_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_BUCKET ??= "intabot-media-test";
process.env.S3_ACCESS_KEY ??= "intabot";
process.env.S3_SECRET_KEY ??= "intabot-dev-secret";
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");
process.env.SESSION_TTL_HOURS ??= "168";
```

Run: `pnpm vitest run apps/api/test/health.e2e.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat(api): add NestJS skeleton with zod-validated configuration and health endpoint"
```

---

## Task 4: DynamoDB module, key builders, and table bootstrap

**Files:**
- Create: `apps/api/src/dynamo/keys.ts`
- Create: `apps/api/src/dynamo/bootstrap.ts`
- Create: `apps/api/src/dynamo/dynamo.module.ts`
- Test: `apps/api/src/dynamo/keys.test.ts`, `apps/api/src/dynamo/bootstrap.test.ts`

**Interfaces:**
- Consumes: `AppConfigService` (Task 3)
- Produces:
  - `keys` — an object of pure key-builder functions, each returning a plain key object
  - `ensureTables(client: DynamoDBClient, names: { main: string; checkpoints: string }, opts?: { recreate?: boolean }): Promise<void>`
  - Injection token `DYNAMO_DOC` providing a configured `DynamoDBDocumentClient`

- [ ] **Step 1: Add the AWS SDK dependencies**

```bash
pnpm --filter @intabot/api add @aws-sdk/client-dynamodb@3.716.0 @aws-sdk/lib-dynamodb@3.716.0 ulid@2.3.0
```

- [ ] **Step 2: Write the failing key-builder test**

`apps/api/src/dynamo/keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { keys } from "./keys";

describe("keys", () => {
  it("builds account keys", () => {
    expect(keys.account("a1")).toEqual({ PK: "ACCT#a1", SK: "#META" });
  });

  it("builds the account list index key", () => {
    expect(keys.accountListIndex("Studio Nord")).toEqual({
      GSI1PK: "TYPE#ACCOUNT",
      GSI1SK: "Studio Nord",
    });
  });

  it("builds post keys", () => {
    expect(keys.post("a1", "p1")).toEqual({ PK: "ACCT#a1", SK: "POST#p1" });
  });

  it("builds the post status index key", () => {
    expect(keys.postStatusIndex("a1", "PENDING_APPROVAL", "2026-08-15T09:00:00.000Z")).toEqual({
      GSI1PK: "ACCT#a1#ST#PENDING_APPROVAL",
      GSI1SK: "2026-08-15T09:00:00.000Z",
    });
  });

  it("builds media asset keys", () => {
    expect(keys.mediaAsset("a1", "m1")).toEqual({ PK: "ACCT#a1", SK: "ASSET#m1" });
  });

  it("builds user keys with a lowercased email", () => {
    expect(keys.user("Operator@Example.com")).toEqual({ PK: "USER#operator@example.com", SK: "#META" });
  });

  it("builds session keys from a token hash", () => {
    expect(keys.session("abc123")).toEqual({ PK: "SESSION#abc123", SK: "#" });
  });

  it("builds webhook dedupe keys", () => {
    expect(keys.webhookSeen("evt-9")).toEqual({ PK: "WH#evt-9", SK: "#" });
  });

  it("builds account insights keys", () => {
    expect(keys.accountInsights("a1", "2026-08-14")).toEqual({
      PK: "ACCT#a1#INS#ACCOUNT",
      SK: "2026-08-14",
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/dynamo/keys.test.ts`
Expected: FAIL — cannot resolve `./keys`.

- [ ] **Step 4: Implement the key builders**

`apps/api/src/dynamo/keys.ts`:

```ts
import type { PostStatus } from "@intabot/shared";

export const keys = {
  account: (accountId: string) => ({ PK: `ACCT#${accountId}`, SK: "#META" }),
  accountListIndex: (name: string) => ({ GSI1PK: "TYPE#ACCOUNT", GSI1SK: name }),

  mediaAsset: (accountId: string, assetId: string) => ({ PK: `ACCT#${accountId}`, SK: `ASSET#${assetId}` }),

  post: (accountId: string, postId: string) => ({ PK: `ACCT#${accountId}`, SK: `POST#${postId}` }),
  postStatusIndex: (accountId: string, status: PostStatus, scheduledAt: string) => ({
    GSI1PK: `ACCT#${accountId}#ST#${status}`,
    GSI1SK: scheduledAt,
  }),

  comment: (postId: string, igCommentId: string) => ({ PK: `POST#${postId}`, SK: `CMT#${igCommentId}` }),
  commentStatusIndex: (accountId: string, status: string, createdAt: string) => ({
    GSI1PK: `ACCT#${accountId}#CST#${status}`,
    GSI1SK: createdAt,
  }),

  accountInsights: (accountId: string, date: string) => ({ PK: `ACCT#${accountId}#INS#ACCOUNT`, SK: date }),
  mediaInsights: (accountId: string, igMediaId: string, date: string) => ({
    PK: `ACCT#${accountId}#INS#MEDIA#${igMediaId}`,
    SK: date,
  }),

  auditLog: (accountId: string, sortKey: string) => ({ PK: `ACCT#${accountId}#LOG`, SK: sortKey }),
  webhookSeen: (eventId: string) => ({ PK: `WH#${eventId}`, SK: "#" }),

  user: (email: string) => ({ PK: `USER#${email.toLowerCase()}`, SK: "#META" }),
  session: (tokenHash: string) => ({ PK: `SESSION#${tokenHash}`, SK: "#" }),
} as const;
```

- [ ] **Step 5: Run the key test to verify it passes**

Run: `pnpm vitest run apps/api/src/dynamo/keys.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Write the failing bootstrap test**

`apps/api/src/dynamo/bootstrap.test.ts`:

```ts
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureTables } from "./bootstrap";

const client = new DynamoDBClient({
  region: "us-east-1",
  endpoint: process.env.DYNAMO_ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

const names = { main: "bootstrap_main_test", checkpoints: "bootstrap_ckpt_test" };

describe("ensureTables", () => {
  beforeAll(async () => { await ensureTables(client, names, { recreate: true }); });

  it("creates the main table with GSI1", async () => {
    const out = await client.send(new DescribeTableCommand({ TableName: names.main }));
    expect(out.Table?.TableStatus).toBe("ACTIVE");
    expect(out.Table?.GlobalSecondaryIndexes?.map((i) => i.IndexName)).toContain("GSI1");
  });

  it("creates the checkpoints table", async () => {
    const out = await client.send(new DescribeTableCommand({ TableName: names.checkpoints }));
    expect(out.Table?.TableStatus).toBe("ACTIVE");
  });

  it("is idempotent when run twice", async () => {
    await expect(ensureTables(client, names)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm infra:up && pnpm vitest run apps/api/src/dynamo/bootstrap.test.ts`
Expected: FAIL — cannot resolve `./bootstrap`.

- [ ] **Step 8: Implement the bootstrap**

`apps/api/src/dynamo/bootstrap.ts`:

```ts
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  ResourceNotFoundException,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb";

export interface TableNames { main: string; checkpoints: string }

async function dropIfExists(client: DynamoDBClient, name: string): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: name }));
    await waitUntilTableNotExists({ client, maxWaitTime: 30 }, { TableName: name });
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
}

async function createIfMissing(client: DynamoDBClient, input: CreateTableCommand): Promise<void> {
  try {
    await client.send(input);
  } catch (err) {
    if (err instanceof ResourceInUseException) return;
    throw err;
  }
}

export async function ensureTables(
  client: DynamoDBClient,
  names: TableNames,
  opts: { recreate?: boolean } = {},
): Promise<void> {
  if (opts.recreate) {
    await dropIfExists(client, names.main);
    await dropIfExists(client, names.checkpoints);
  }

  await createIfMissing(
    client,
    new CreateTableCommand({
      TableName: names.main,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );

  await createIfMissing(
    client,
    new CreateTableCommand({
      TableName: names.checkpoints,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    }),
  );

  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: names.main });
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: names.checkpoints });
}
```

- [ ] **Step 9: Run the bootstrap test to verify it passes**

Run: `pnpm vitest run apps/api/src/dynamo/bootstrap.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 10: Create the Nest module**

`apps/api/src/dynamo/dynamo.module.ts`:

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Global, Module } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";

export const DYNAMO_DOC = Symbol("DYNAMO_DOC");
export const DYNAMO_RAW = Symbol("DYNAMO_RAW");

@Global()
@Module({
  providers: [
    {
      provide: DYNAMO_RAW,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new DynamoDBClient({
          region: config.dynamo.region,
          ...(config.dynamo.endpoint ? { endpoint: config.dynamo.endpoint } : {}),
        }),
    },
    {
      provide: DYNAMO_DOC,
      inject: [DYNAMO_RAW],
      useFactory: (raw: DynamoDBClient) =>
        DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } }),
    },
  ],
  exports: [DYNAMO_DOC, DYNAMO_RAW],
})
export class DynamoModule {}
```

Add `DynamoModule` to `AppModule`'s `imports` array in `apps/api/src/app.module.ts`.

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat(api): add DynamoDB key builders, table bootstrap, and client module"
```

---

## Task 5: Token encryption service

**Files:**
- Create: `apps/api/src/crypto/token-crypto.service.ts`, `apps/api/src/crypto/crypto.module.ts`
- Test: `apps/api/src/crypto/token-crypto.service.test.ts`

**Interfaces:**
- Consumes: `AppConfigService.tokenEncryptionKey` (Task 3)
- Produces: `TokenCryptoService` with `encrypt(plaintext: string): string` returning `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`, and `decrypt(payload: string): string` which throws on tampering or an unknown version prefix

- [ ] **Step 1: Write the failing test**

`apps/api/src/crypto/token-crypto.service.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/crypto/token-crypto.service.test.ts`
Expected: FAIL — cannot resolve `./token-crypto.service`.

- [ ] **Step 3: Implement the service**

`apps/api/src/crypto/token-crypto.service.ts`:

```ts
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
    return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const parts = payload.split(":");
    if (parts.length !== 4) throw new Error("malformed encrypted payload");
    const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
    if (version !== VERSION) throw new Error(`unsupported payload version: ${version}`);

    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  }
}
```

`apps/api/src/crypto/crypto.module.ts`:

```ts
import { Global, Module } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { TOKEN_ENCRYPTION_KEY, TokenCryptoService } from "./token-crypto.service";

@Global()
@Module({
  providers: [
    { provide: TOKEN_ENCRYPTION_KEY, inject: [AppConfigService], useFactory: (c: AppConfigService) => c.tokenEncryptionKey },
    TokenCryptoService,
  ],
  exports: [TokenCryptoService],
})
export class CryptoModule {}
```

Add `CryptoModule` to `AppModule`'s `imports` array.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/crypto/token-crypto.service.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add AES-256-GCM token encryption service"
```

---

## Task 6: Account repository

**Files:**
- Create: `apps/api/src/accounts/account.repository.ts`
- Create: `apps/api/test/dynamo-fixture.ts`
- Test: `apps/api/src/accounts/account.repository.test.ts`

**Interfaces:**
- Consumes: `keys` (Task 4), `DYNAMO_DOC` (Task 4), `AccountSchema` (Task 2)
- Produces: `AccountRepository` with
  - `create(input: CreateAccountInput): Promise<Account>` — throws `AccountAlreadyExistsError` on duplicate id
  - `get(accountId: string): Promise<Account | null>`
  - `list(): Promise<Account[]>` — via GSI1, ordered by name
  - `update(accountId: string, patch: Partial<Pick<Account, "name" | "status" | "dryRun" | "moderationPaused" | "accessTokenEncrypted" | "tokenExpiresAt">>): Promise<Account>`
  - `CreateAccountInput = { id?: string; name: string; igUserId: string; username: string; accessTokenEncrypted: string; tokenExpiresAt: string }`

- [ ] **Step 1: Create the shared test fixture**

`apps/api/test/dynamo-fixture.ts`:

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ensureTables } from "../src/dynamo/bootstrap";

export const tableMain = process.env.DYNAMO_TABLE_MAIN!;
export const tableCheckpoints = process.env.DYNAMO_TABLE_CHECKPOINTS!;

export const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION!,
  endpoint: process.env.DYNAMO_ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

export const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

/** Drops and recreates both tables. Call in beforeEach for isolated tests. */
export async function resetTables(): Promise<void> {
  await ensureTables(rawClient, { main: tableMain, checkpoints: tableCheckpoints }, { recreate: true });
}
```

- [ ] **Step 2: Write the failing repository test**

`apps/api/src/accounts/account.repository.test.ts`:

```ts
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
  beforeEach(async () => { await resetTables(); });

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
    await expect(repo.create({ ...input, id: "fixed-id" })).rejects.toBeInstanceOf(AccountAlreadyExistsError);
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
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
  });

  it("keeps the GSI1SK in sync when the name changes", async () => {
    const created = await repo.create(input);
    await repo.update(created.id, { name: "Aardvark Co" });
    const listed = await repo.list();
    expect(listed[0]?.name).toBe("Aardvark Co");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/accounts/account.repository.test.ts`
Expected: FAIL — cannot resolve `./account.repository`.

- [ ] **Step 4: Implement the repository**

`apps/api/src/accounts/account.repository.ts`:

```ts
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { Account, AccountSchema } from "@intabot/shared";
import { ulid } from "ulid";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export class AccountAlreadyExistsError extends Error {
  constructor(id: string) { super(`account already exists: ${id}`); }
}
export class AccountNotFoundError extends Error {
  constructor(id: string) { super(`account not found: ${id}`); }
}

export interface CreateAccountInput {
  id?: string;
  name: string;
  igUserId: string;
  username: string;
  accessTokenEncrypted: string;
  tokenExpiresAt: string;
}

export type UpdateAccountPatch = Partial<
  Pick<Account, "name" | "status" | "dryRun" | "moderationPaused" | "accessTokenEncrypted" | "tokenExpiresAt">
>;

@Injectable()
export class AccountRepository {
  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  private readonly table: string;

  async create(input: CreateAccountInput): Promise<Account> {
    const now = new Date().toISOString();
    const account = AccountSchema.parse({
      id: input.id ?? ulid(),
      name: input.name,
      igUserId: input.igUserId,
      username: input.username,
      status: "ACTIVE",
      accessTokenEncrypted: input.accessTokenEncrypted,
      tokenExpiresAt: input.tokenExpiresAt,
      dryRun: true,
      moderationPaused: false,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { ...keys.account(account.id), ...keys.accountListIndex(account.name), ...account },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) throw new AccountAlreadyExistsError(account.id);
      throw err;
    }
    return account;
  }

  async get(accountId: string): Promise<Account | null> {
    const out = await this.doc.send(new GetCommand({ TableName: this.table, Key: keys.account(accountId) }));
    return out.Item ? AccountSchema.parse(out.Item) : null;
  }

  async list(): Promise<Account[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "TYPE#ACCOUNT" },
        ScanIndexForward: true,
      }),
    );
    return (out.Items ?? []).map((item) => AccountSchema.parse(item));
  }

  async update(accountId: string, patch: UpdateAccountPatch): Promise<Account> {
    const setParts: string[] = ["#updatedAt = :updatedAt"];
    const names: Record<string, string> = { "#updatedAt": "updatedAt" };
    const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString() };

    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      setParts.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = value;
    }

    if (patch.name !== undefined) {
      setParts.push("#GSI1SK = :GSI1SK");
      names["#GSI1SK"] = "GSI1SK";
      values[":GSI1SK"] = patch.name;
    }

    try {
      const out = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: keys.account(accountId),
          UpdateExpression: `SET ${setParts.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: "attribute_exists(PK)",
          ReturnValues: "ALL_NEW",
        }),
      );
      return AccountSchema.parse(out.Attributes);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) throw new AccountNotFoundError(accountId);
      throw err;
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/accounts/account.repository.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add account repository backed by DynamoDB"
```

---

## Task 7: Post repository with the double-publish guard

This is the most correctness-sensitive task in Phase 1. The conditional-write transition is what prevents a retried publish job from creating a second Instagram container.

**Files:**
- Create: `apps/api/src/posts/post.repository.ts`
- Create: `apps/api/src/posts/posts.module.ts`
- Test: `apps/api/src/posts/post.repository.test.ts`

**Interfaces:**
- Consumes: `keys` (Task 4), `PostSchema` / `PostStatus` (Task 2), `DYNAMO_DOC` (Task 4)
- Produces: `PostRepository` with
  - `create(input: CreatePostInput): Promise<Post>` — status `DRAFT`, version `1`
  - `get(accountId: string, postId: string): Promise<Post | null>`
  - `listByStatus(accountId: string, status: PostStatus): Promise<Post[]>` — GSI1, ordered by `scheduledAt`
  - `transition(args: TransitionArgs): Promise<Post>` — throws `PostTransitionConflictError` when the current status or version does not match
  - `TransitionArgs = { accountId: string; postId: string; expectedStatus: PostStatus; expectedVersion: number; nextStatus: PostStatus; patch?: Partial<Pick<Post, "caption" | "hashtags" | "scheduledAt" | "containerId" | "igMediaId" | "permalink" | "failureReason">> }`

- [ ] **Step 1: Write the failing test**

`apps/api/src/posts/post.repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { PostRepository, PostTransitionConflictError } from "./post.repository";

const repo = new PostRepository(docClient, tableMain);

const input = {
  accountId: "acct-1",
  format: "REEL" as const,
  mediaAssetIds: ["asset-1"],
  caption: "Morning light.",
  hashtags: ["#studio"],
  scheduledAt: "2026-08-15T09:00:00.000Z",
};

describe("PostRepository", () => {
  beforeEach(async () => { await resetTables(); });

  it("creates a post as DRAFT at version 1", async () => {
    const post = await repo.create(input);
    expect(post.status).toBe("DRAFT");
    expect(post.version).toBe(1);
  });

  it("transitions status and increments version", async () => {
    const post = await repo.create(input);
    const moved = await repo.transition({
      accountId: post.accountId,
      postId: post.id,
      expectedStatus: "DRAFT",
      expectedVersion: 1,
      nextStatus: "PENDING_APPROVAL",
    });
    expect(moved.status).toBe("PENDING_APPROVAL");
    expect(moved.version).toBe(2);
  });

  it("applies a patch during a transition", async () => {
    const post = await repo.create(input);
    const moved = await repo.transition({
      accountId: post.accountId,
      postId: post.id,
      expectedStatus: "DRAFT",
      expectedVersion: 1,
      nextStatus: "PUBLISHING",
      patch: { containerId: "container-42" },
    });
    expect(moved.containerId).toBe("container-42");
  });

  it("rejects a transition from the wrong status", async () => {
    const post = await repo.create(input);
    await expect(
      repo.transition({
        accountId: post.accountId,
        postId: post.id,
        expectedStatus: "APPROVED",
        expectedVersion: 1,
        nextStatus: "PUBLISHING",
      }),
    ).rejects.toBeInstanceOf(PostTransitionConflictError);
  });

  it("rejects a transition with a stale version", async () => {
    const post = await repo.create(input);
    await repo.transition({
      accountId: post.accountId, postId: post.id,
      expectedStatus: "DRAFT", expectedVersion: 1, nextStatus: "PENDING_APPROVAL",
    });
    await expect(
      repo.transition({
        accountId: post.accountId, postId: post.id,
        expectedStatus: "PENDING_APPROVAL", expectedVersion: 1, nextStatus: "APPROVED",
      }),
    ).rejects.toBeInstanceOf(PostTransitionConflictError);
  });

  it("lets only one of two concurrent identical transitions win", async () => {
    const post = await repo.create(input);
    const attempt = () =>
      repo.transition({
        accountId: post.accountId, postId: post.id,
        expectedStatus: "DRAFT", expectedVersion: 1, nextStatus: "PUBLISHING",
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("lists posts by status ordered by scheduledAt", async () => {
    const later = await repo.create({ ...input, scheduledAt: "2026-08-20T09:00:00.000Z" });
    const sooner = await repo.create({ ...input, scheduledAt: "2026-08-16T09:00:00.000Z" });
    for (const p of [later, sooner]) {
      await repo.transition({
        accountId: p.accountId, postId: p.id,
        expectedStatus: "DRAFT", expectedVersion: 1, nextStatus: "PENDING_APPROVAL",
      });
    }
    const queue = await repo.listByStatus("acct-1", "PENDING_APPROVAL");
    expect(queue.map((p) => p.scheduledAt)).toEqual([
      "2026-08-16T09:00:00.000Z",
      "2026-08-20T09:00:00.000Z",
    ]);
  });

  it("removes a post from the old status index after transitioning", async () => {
    const post = await repo.create(input);
    await repo.transition({
      accountId: post.accountId, postId: post.id,
      expectedStatus: "DRAFT", expectedVersion: 1, nextStatus: "PENDING_APPROVAL",
    });
    expect(await repo.listByStatus("acct-1", "DRAFT")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/posts/post.repository.test.ts`
Expected: FAIL — cannot resolve `./post.repository`.

- [ ] **Step 3: Implement the repository**

`apps/api/src/posts/post.repository.ts`:

```ts
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { Post, PostFormat, PostSchema, PostStatus } from "@intabot/shared";
import { ulid } from "ulid";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export class PostTransitionConflictError extends Error {
  constructor(postId: string, expectedStatus: PostStatus, expectedVersion: number) {
    super(`post ${postId} is not at ${expectedStatus}@v${expectedVersion}`);
  }
}

export interface CreatePostInput {
  accountId: string;
  format: PostFormat;
  mediaAssetIds: string[];
  caption: string;
  hashtags: string[];
  scheduledAt: string;
}

export type PostPatch = Partial<
  Pick<Post, "caption" | "hashtags" | "scheduledAt" | "containerId" | "igMediaId" | "permalink" | "failureReason">
>;

export interface TransitionArgs {
  accountId: string;
  postId: string;
  expectedStatus: PostStatus;
  expectedVersion: number;
  nextStatus: PostStatus;
  patch?: PostPatch;
}

@Injectable()
export class PostRepository {
  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  private readonly table: string;

  async create(input: CreatePostInput): Promise<Post> {
    const now = new Date().toISOString();
    const post = PostSchema.parse({
      id: ulid(),
      accountId: input.accountId,
      status: "DRAFT",
      format: input.format,
      version: 1,
      mediaAssetIds: input.mediaAssetIds,
      caption: input.caption,
      hashtags: input.hashtags,
      scheduledAt: input.scheduledAt,
      createdAt: now,
      updatedAt: now,
    });

    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...keys.post(post.accountId, post.id),
          ...keys.postStatusIndex(post.accountId, post.status, post.scheduledAt),
          ...post,
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );
    return post;
  }

  async get(accountId: string, postId: string): Promise<Post | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.post(accountId, postId) }),
    );
    return out.Item ? PostSchema.parse(out.Item) : null;
  }

  async listByStatus(accountId: string, status: PostStatus): Promise<Post[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `ACCT#${accountId}#ST#${status}` },
        ScanIndexForward: true,
      }),
    );
    return (out.Items ?? []).map((item) => PostSchema.parse(item));
  }

  /**
   * Conditional status transition. The condition is what makes a retried
   * publish job a no-op instead of a second Instagram container: if another
   * worker already moved the post, the current status/version no longer match
   * and this throws PostTransitionConflictError.
   */
  async transition(args: TransitionArgs): Promise<Post> {
    const { accountId, postId, expectedStatus, expectedVersion, nextStatus, patch = {} } = args;

    const scheduledAt = patch.scheduledAt;
    const setParts = [
      "#status = :nextStatus",
      "#version = :nextVersion",
      "#updatedAt = :updatedAt",
      "#GSI1PK = :GSI1PK",
    ];
    const names: Record<string, string> = {
      "#status": "status",
      "#version": "version",
      "#updatedAt": "updatedAt",
      "#GSI1PK": "GSI1PK",
    };
    const values: Record<string, unknown> = {
      ":nextStatus": nextStatus,
      ":nextVersion": expectedVersion + 1,
      ":updatedAt": new Date().toISOString(),
      ":GSI1PK": `ACCT#${accountId}#ST#${nextStatus}`,
      ":expectedStatus": expectedStatus,
      ":expectedVersion": expectedVersion,
    };

    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      setParts.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = value;
    }

    if (scheduledAt !== undefined) {
      setParts.push("#GSI1SK = :GSI1SK");
      names["#GSI1SK"] = "GSI1SK";
      values[":GSI1SK"] = scheduledAt;
    }

    try {
      const out = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: keys.post(accountId, postId),
          UpdateExpression: `SET ${setParts.join(", ")}`,
          ConditionExpression:
            "attribute_exists(PK) AND #status = :expectedStatus AND #version = :expectedVersion",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return PostSchema.parse(out.Attributes);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new PostTransitionConflictError(postId, expectedStatus, expectedVersion);
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/posts/post.repository.test.ts`
Expected: PASS, 8 tests. The concurrency test must show exactly one fulfilled and one rejected result.

- [ ] **Step 5: Register the repository in a module**

`apps/api/src/posts/posts.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PostRepository } from "./post.repository";

@Module({ providers: [PostRepository], exports: [PostRepository] })
export class PostsModule {}
```

Add `PostsModule` to `AppModule`'s `imports` array. Task 12's smoke test resolves
`PostRepository` from the application container, so it must be registered here.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add post repository with conditional status transitions"
```

---

## Task 8: InstagramPort interface and fake adapter

**Files:**
- Create: `apps/api/src/instagram/instagram.port.ts`
- Create: `apps/api/src/instagram/fake-instagram.adapter.ts`
- Create: `apps/api/src/instagram/instagram.module.ts`
- Test: `apps/api/src/instagram/fake-instagram.adapter.test.ts`

**Interfaces:**
- Consumes: `Account` (Task 2)
- Produces:
  - `INSTAGRAM_PORT` injection token
  - `InstagramPort` interface (exact signatures below)
  - `ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR'`
  - `FakeInstagramAdapter` with test controls: `setProcessingPolls(n)`, `failNextContainer(errorCode)`, `getPublished()`, `getReplies()`, `reset()`

- [ ] **Step 1: Write the failing test**

`apps/api/src/instagram/fake-instagram.adapter.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { FakeInstagramAdapter } from "./fake-instagram.adapter";

const account = {
  id: "acct-1",
  name: "Studio Nord",
  igUserId: "17841400000000000",
  username: "studionord",
  status: "ACTIVE",
  accessTokenEncrypted: "v1:a:b:c",
  tokenExpiresAt: "2026-10-13T00:00:00.000Z",
  dryRun: false,
  moderationPaused: false,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
} satisfies Account;

describe("FakeInstagramAdapter", () => {
  let adapter: FakeInstagramAdapter;
  beforeEach(() => { adapter = new FakeInstagramAdapter(); });

  it("creates a container and returns an id", async () => {
    const { containerId } = await adapter.createContainer(account, {
      format: "REEL", mediaUrl: "https://example.test/a.mp4", caption: "hi",
    });
    expect(containerId).toMatch(/^fake-container-/);
  });

  it("reports IN_PROGRESS for the configured number of polls, then FINISHED", async () => {
    adapter.setProcessingPolls(2);
    const { containerId } = await adapter.createContainer(account, {
      format: "REEL", mediaUrl: "https://example.test/a.mp4", caption: "hi",
    });
    expect(await adapter.getContainerStatus(account, containerId)).toBe("IN_PROGRESS");
    expect(await adapter.getContainerStatus(account, containerId)).toBe("IN_PROGRESS");
    expect(await adapter.getContainerStatus(account, containerId)).toBe("FINISHED");
  });

  it("reports ERROR when the container is configured to fail", async () => {
    adapter.failNextContainer("MEDIA_TOO_LARGE");
    const { containerId } = await adapter.createContainer(account, {
      format: "IMAGE", mediaUrl: "https://example.test/a.jpg", caption: "hi",
    });
    expect(await adapter.getContainerStatus(account, containerId)).toBe("ERROR");
  });

  it("publishes a finished container and records it", async () => {
    adapter.setProcessingPolls(0);
    const { containerId } = await adapter.createContainer(account, {
      format: "IMAGE", mediaUrl: "https://example.test/a.jpg", caption: "hi",
    });
    const result = await adapter.publishContainer(account, containerId);
    expect(result.permalink).toContain("instagram.test");
    expect(adapter.getPublished()).toHaveLength(1);
  });

  it("refuses to publish a container that is still processing", async () => {
    adapter.setProcessingPolls(5);
    const { containerId } = await adapter.createContainer(account, {
      format: "REEL", mediaUrl: "https://example.test/a.mp4", caption: "hi",
    });
    await expect(adapter.publishContainer(account, containerId)).rejects.toThrow(/not finished/i);
  });

  it("refuses to publish the same container twice", async () => {
    adapter.setProcessingPolls(0);
    const { containerId } = await adapter.createContainer(account, {
      format: "IMAGE", mediaUrl: "https://example.test/a.jpg", caption: "hi",
    });
    await adapter.publishContainer(account, containerId);
    await expect(adapter.publishContainer(account, containerId)).rejects.toThrow(/already published/i);
  });

  it("records comment replies", async () => {
    const { replyId } = await adapter.replyToComment(account, "cmt-1", "Thank you!");
    expect(replyId).toMatch(/^fake-reply-/);
    expect(adapter.getReplies()[0]).toMatchObject({ commentId: "cmt-1", text: "Thank you!" });
  });

  it("returns deterministic account insights for the requested range", async () => {
    const points = await adapter.getAccountInsights(account, ["reach"], {
      from: "2026-08-01", to: "2026-08-03",
    });
    expect(points.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(points[0]?.metrics.reach).toBeTypeOf("number");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/instagram/fake-instagram.adapter.test.ts`
Expected: FAIL — cannot resolve `./fake-instagram.adapter`.

- [ ] **Step 3: Define the port**

`apps/api/src/instagram/instagram.port.ts`:

```ts
import type { Account, PostFormat } from "@intabot/shared";

export const INSTAGRAM_PORT = Symbol("INSTAGRAM_PORT");

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR";

export interface ContainerInput {
  format: PostFormat;
  /** Publicly reachable HTTPS URL. Instagram fetches the media from here. */
  mediaUrl: string;
  caption: string;
  /** Child container ids. Only used when format is CAROUSEL. */
  childContainerIds?: string[];
  isCarouselItem?: boolean;
}

export interface PublishResult { igMediaId: string; permalink: string }
export interface ReplyResult { replyId: string }
export interface DateRange { from: string; to: string }

export interface InsightPoint {
  date: string;
  metrics: Record<string, number>;
}

export interface InstagramPort {
  createContainer(account: Account, input: ContainerInput): Promise<{ containerId: string }>;
  getContainerStatus(account: Account, containerId: string): Promise<ContainerStatus>;
  publishContainer(account: Account, containerId: string): Promise<PublishResult>;
  replyToComment(account: Account, commentId: string, text: string): Promise<ReplyResult>;
  getAccountInsights(account: Account, metrics: string[], range: DateRange): Promise<InsightPoint[]>;
  getMediaInsights(account: Account, igMediaId: string): Promise<InsightPoint[]>;
}
```

- [ ] **Step 4: Implement the fake adapter**

`apps/api/src/instagram/fake-instagram.adapter.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { Account } from "@intabot/shared";
import type {
  ContainerInput, ContainerStatus, DateRange, InsightPoint,
  InstagramPort, PublishResult, ReplyResult,
} from "./instagram.port";

interface FakeContainer {
  id: string;
  accountId: string;
  input: ContainerInput;
  pollsRemaining: number;
  failed: boolean;
  published: boolean;
}

export interface PublishedRecord { accountId: string; containerId: string; igMediaId: string; caption: string }
export interface ReplyRecord { accountId: string; commentId: string; text: string; replyId: string }

@Injectable()
export class FakeInstagramAdapter implements InstagramPort {
  private containers = new Map<string, FakeContainer>();
  private published: PublishedRecord[] = [];
  private replies: ReplyRecord[] = [];
  private counter = 0;
  private processingPolls = 1;
  private nextContainerFails = false;

  /** How many getContainerStatus calls return IN_PROGRESS before FINISHED. */
  setProcessingPolls(n: number): void { this.processingPolls = n; }

  /** Makes the next created container report ERROR. */
  failNextContainer(_errorCode: string): void { this.nextContainerFails = true; }

  getPublished(): PublishedRecord[] { return [...this.published]; }
  getReplies(): ReplyRecord[] { return [...this.replies]; }

  reset(): void {
    this.containers.clear();
    this.published = [];
    this.replies = [];
    this.counter = 0;
    this.processingPolls = 1;
    this.nextContainerFails = false;
  }

  async createContainer(account: Account, input: ContainerInput): Promise<{ containerId: string }> {
    const containerId = `fake-container-${++this.counter}`;
    this.containers.set(containerId, {
      id: containerId,
      accountId: account.id,
      input,
      pollsRemaining: this.processingPolls,
      failed: this.nextContainerFails,
      published: false,
    });
    this.nextContainerFails = false;
    return { containerId };
  }

  async getContainerStatus(_account: Account, containerId: string): Promise<ContainerStatus> {
    const container = this.containers.get(containerId);
    if (!container) throw new Error(`unknown container: ${containerId}`);
    if (container.failed) return "ERROR";
    if (container.pollsRemaining > 0) {
      container.pollsRemaining -= 1;
      return "IN_PROGRESS";
    }
    return "FINISHED";
  }

  async publishContainer(account: Account, containerId: string): Promise<PublishResult> {
    const container = this.containers.get(containerId);
    if (!container) throw new Error(`unknown container: ${containerId}`);
    if (container.published) throw new Error(`container already published: ${containerId}`);
    if (container.failed || container.pollsRemaining > 0) {
      throw new Error(`container is not finished: ${containerId}`);
    }

    container.published = true;
    const igMediaId = `fake-media-${this.counter}`;
    this.published.push({
      accountId: account.id,
      containerId,
      igMediaId,
      caption: container.input.caption,
    });
    return { igMediaId, permalink: `https://instagram.test/p/${igMediaId}` };
  }

  async replyToComment(account: Account, commentId: string, text: string): Promise<ReplyResult> {
    const replyId = `fake-reply-${++this.counter}`;
    this.replies.push({ accountId: account.id, commentId, text, replyId });
    return { replyId };
  }

  async getAccountInsights(_account: Account, metrics: string[], range: DateRange): Promise<InsightPoint[]> {
    return eachDate(range).map((date, index) => ({
      date,
      metrics: Object.fromEntries(metrics.map((m, mi) => [m, 100 + index * 10 + mi])),
    }));
  }

  async getMediaInsights(_account: Account, igMediaId: string): Promise<InsightPoint[]> {
    const date = new Date().toISOString().slice(0, 10);
    return [{ date, metrics: { plays: 500, likes: 42, comments: 7, saves: 3, reach: 900 } }];
  }
}

function eachDate(range: DateRange): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00.000Z`);
  const end = new Date(`${range.to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/src/instagram/fake-instagram.adapter.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Create the module that selects an implementation**

`apps/api/src/instagram/instagram.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { FakeInstagramAdapter } from "./fake-instagram.adapter";
import { INSTAGRAM_PORT } from "./instagram.port";

// Phase 1 always binds the fake. Phase 2 adds the real adapter and selects
// between them based on configuration.
@Module({
  providers: [FakeInstagramAdapter, { provide: INSTAGRAM_PORT, useExisting: FakeInstagramAdapter }],
  exports: [INSTAGRAM_PORT],
})
export class InstagramModule {}
```

Add `InstagramModule` to `AppModule`'s `imports` array.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add InstagramPort interface and in-memory fake adapter"
```

---

## Task 9: Operator authentication (users, sessions, guard, CLI)

**Files:**
- Create: `apps/api/src/auth/user.repository.ts`
- Create: `apps/api/src/auth/password.service.ts`
- Create: `apps/api/src/auth/session.service.ts`
- Create: `apps/api/src/auth/auth.guard.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/cli/create-user.ts`
- Test: `apps/api/src/auth/password.service.test.ts`, `apps/api/src/auth/session.service.test.ts`, `apps/api/test/auth.e2e.test.ts`

**Interfaces:**
- Consumes: `keys.user`, `keys.session` (Task 4), `UserSchema` (Task 2), `DYNAMO_DOC` (Task 4), `AppConfigService.session.ttlHours` (Task 3)
- Produces:
  - `PasswordService.hash(plain: string): Promise<string>`, `.verify(hash: string, plain: string): Promise<boolean>`
  - `SessionService.create(email: string): Promise<{ token: string; expiresAt: string }>`, `.verify(token: string): Promise<string | null>` (returns the email), `.revoke(token: string): Promise<void>`
  - `UserRepository.create(email, passwordHash)`, `.get(email): Promise<User | null>`
  - `AuthGuard` — reads the `intabot_session` cookie, attaches `request.userEmail`
  - `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @intabot/api add argon2@0.41.1 cookie-parser@1.4.7
pnpm --filter @intabot/api add -D @types/cookie-parser@1.4.8
```

- [ ] **Step 2: Write the failing password test**

`apps/api/src/auth/password.service.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/auth/password.service.test.ts`
Expected: FAIL — cannot resolve `./password.service`.

- [ ] **Step 4: Implement the password service**

`apps/api/src/auth/password.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import argon2 from "argon2";

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 5: Run the password test to verify it passes**

Run: `pnpm vitest run apps/api/src/auth/password.service.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing session test**

`apps/api/src/auth/session.service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { SessionService } from "./session.service";

const svc = new SessionService(docClient, tableMain, 168);

describe("SessionService", () => {
  beforeEach(async () => { await resetTables(); });

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
    const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
    const out = await docClient.send(new ScanCommand({ TableName: tableMain }));
    expect(JSON.stringify(out.Items)).not.toContain(token);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/auth/session.service.test.ts`
Expected: FAIL — cannot resolve `./session.service`.

- [ ] **Step 8: Implement the session service**

`apps/api/src/auth/session.service.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class SessionService {
  private readonly table: string;
  private readonly ttlHours: number;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
    ttlHours?: number,
  ) {
    if (typeof tableOrConfig === "string") {
      this.table = tableOrConfig;
      this.ttlHours = ttlHours ?? 168;
    } else {
      this.table = tableOrConfig.dynamo.tableMain;
      this.ttlHours = tableOrConfig.session.ttlHours;
    }
  }

  async create(email: string): Promise<{ token: string; expiresAt: string }> {
    const token = randomBytes(32).toString("hex");
    const expiresAtMs = Date.now() + this.ttlHours * 3_600_000;
    const expiresAt = new Date(expiresAtMs).toISOString();

    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...keys.session(hashToken(token)),
          email: email.toLowerCase(),
          expiresAt,
          // DynamoDB TTL attribute — seconds since epoch.
          ttl: Math.floor(expiresAtMs / 1000),
        },
      }),
    );
    return { token, expiresAt };
  }

  async verify(token: string): Promise<string | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.session(hashToken(token)) }),
    );
    if (!out.Item) return null;

    const expiresAt = out.Item["expiresAt"] as string | undefined;
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return null;

    return (out.Item["email"] as string) ?? null;
  }

  async revoke(token: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: keys.session(hashToken(token)) }),
    );
  }
}
```

- [ ] **Step 9: Run the session test to verify it passes**

Run: `pnpm vitest run apps/api/src/auth/session.service.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 10: Write the failing auth end-to-end test**

`apps/api/test/auth.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { resetTables } from "./dynamo-fixture";

describe("auth", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    const users = app.get(UserRepository);
    const passwords = app.get(PasswordService);
    await users.create("operator@example.com", await passwords.hash("s3cret"));
  });

  afterAll(async () => { await app.close(); });

  it("logs in and sets an httpOnly session cookie", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" })
      .expect(200);

    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toContain("intabot_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "wrong" })
      .expect(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects an unknown email with 401", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "s3cret" })
      .expect(401);
  });

  it("returns 401 from /auth/me without a session", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("returns the email from /auth/me with a valid session", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" });
    const cookie = login.headers["set-cookie"]!;

    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body).toEqual({ email: "operator@example.com" });
  });

  it("invalidates the session on logout", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" });
    const cookie = login.headers["set-cookie"]!;

    await request(app.getHttpServer()).post("/auth/logout").set("Cookie", cookie).expect(200);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(401);
  });

  it("never returns the password hash", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" });
    expect(JSON.stringify(login.body)).not.toContain("argon2");
  });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/auth.e2e.test.ts`
Expected: FAIL — cannot resolve `../src/auth/user.repository`.

- [ ] **Step 12: Implement the user repository, guard, controller, and module**

`apps/api/src/auth/user.repository.ts`:

```ts
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { User, UserSchema } from "@intabot/shared";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

@Injectable()
export class UserRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async create(email: string, passwordHash: string): Promise<User> {
    const user = UserSchema.parse({ email, passwordHash, createdAt: new Date().toISOString() });
    await this.doc.send(
      new PutCommand({ TableName: this.table, Item: { ...keys.user(user.email), ...user } }),
    );
    return user;
  }

  async get(email: string): Promise<User | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.user(email) }),
    );
    return out.Item ? UserSchema.parse(out.Item) : null;
  }
}
```

`apps/api/src/auth/auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "./session.service";

export const SESSION_COOKIE = "intabot_session";

export interface AuthedRequest extends Request {
  userEmail?: string;
  cookies: Record<string, string | undefined>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();

    const email = await this.sessions.verify(token);
    if (!email) throw new UnauthorizedException();

    request.userEmail = email;
    return true;
  }
}
```

`apps/api/src/auth/auth.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AppConfigService } from "../config/config.service";
import { AuthGuard, AuthedRequest, SESSION_COOKIE } from "./auth.guard";
import { PasswordService } from "./password.service";
import { SessionService } from "./session.service";
import { UserRepository } from "./user.repository";

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

@Controller("auth")
export class AuthController {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException();

    const user = await this.users.get(parsed.data.email);
    if (!user) throw new UnauthorizedException();

    const ok = await this.passwords.verify(user.passwordHash, parsed.data.password);
    if (!ok) throw new UnauthorizedException();

    const { token, expiresAt } = await this.sessions.create(user.email);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.nodeEnv === "production",
      expires: new Date(expiresAt),
      path: "/",
    });
    return { email: user.email };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await this.sessions.revoke(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    return { email: req.userEmail };
  }
}
```

`apps/api/src/auth/auth.module.ts`:

```ts
import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { PasswordService } from "./password.service";
import { SessionService } from "./session.service";
import { UserRepository } from "./user.repository";

@Global()
@Module({
  controllers: [AuthController],
  providers: [UserRepository, PasswordService, SessionService, AuthGuard],
  exports: [UserRepository, PasswordService, SessionService, AuthGuard],
})
export class AuthModule {}
```

Add `AuthModule` to `AppModule`'s `imports`, and register the cookie parser in `apps/api/src/main.ts` before `app.listen`:

```ts
import cookieParser from "cookie-parser";
// ...
app.use(cookieParser());
```

- [ ] **Step 13: Run the auth end-to-end test to verify it passes**

Run: `pnpm vitest run apps/api/test/auth.e2e.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 14: Add the operator provisioning CLI**

`apps/api/src/cli/create-user.ts`:

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PasswordService } from "../auth/password.service";
import { UserRepository } from "../auth/user.repository";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("usage: pnpm --filter @intabot/api exec tsx src/cli/create-user.ts <email> <password>");
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  try {
    const users = app.get(UserRepository);
    const passwords = app.get(PasswordService);
    const user = await users.create(email, await passwords.hash(password));
    console.log(`created operator: ${user.email}`);
  } finally {
    await app.close();
  }
}

void main();
```

Add `tsx` and a script to `apps/api/package.json`:

```bash
pnpm --filter @intabot/api add -D tsx@4.19.2
```

Add to `apps/api/package.json` scripts: `"create-user": "tsx src/cli/create-user.ts"`.

- [ ] **Step 15: Verify the CLI end to end**

The CLI writes to the main table, so that table must exist first. `pnpm test`
creates it as a side effect of the repository tests, so run the suite once:

```bash
pnpm infra:up
pnpm test
pnpm --filter @intabot/api run create-user operator@example.com hunter2
```

Expected: `created operator: operator@example.com`.

Note that `resetTables()` in the test fixture drops and recreates the tables, so
re-running the suite deletes any operator you created. Create the operator after
your last test run, or re-run this command when you need to log in.

- [ ] **Step 16: Commit**

```bash
git add apps/api
git commit -m "feat(api): add operator authentication with argon2 passwords and DynamoDB sessions"
```

---

## Task 10: Account REST surface

**Files:**
- Create: `apps/api/src/accounts/accounts.controller.ts`, `apps/api/src/accounts/accounts.module.ts`
- Test: `apps/api/test/accounts.e2e.test.ts`

**Interfaces:**
- Consumes: `AccountRepository` (Task 6), `TokenCryptoService` (Task 5), `AuthGuard` (Task 9)
- Produces:
  - `GET /accounts` → `Account[]` with `accessTokenEncrypted` stripped
  - `GET /accounts/:id` → account or 404
  - `POST /accounts` → creates an account, encrypting the supplied plaintext token
  - `PATCH /accounts/:id` → updates `name`, `status`, `dryRun`, `moderationPaused`
  - `AccountView` — the response shape (`Account` minus `accessTokenEncrypted`)

- [ ] **Step 1: Write the failing test**

`apps/api/test/accounts.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { resetTables } from "./dynamo-fixture";

describe("accounts", () => {
  let app: INestApplication;
  let cookie: string[];

  const body = {
    name: "Studio Nord",
    igUserId: "17841400000000000",
    username: "studionord",
    accessToken: "IGQVJ-plaintext-token",
    tokenExpiresAt: "2026-10-13T00:00:00.000Z",
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await app.get(UserRepository).create("operator@example.com", await app.get(PasswordService).hash("s3cret"));
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" });
    cookie = login.headers["set-cookie"]!;
  });

  afterAll(async () => { await app.close(); });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get("/accounts").expect(401);
  });

  it("creates an account", async () => {
    const res = await request(app.getHttpServer())
      .post("/accounts").set("Cookie", cookie).send(body).expect(201);
    expect(res.body.username).toBe("studionord");
    expect(res.body.status).toBe("ACTIVE");
  });

  it("never returns the token, encrypted or plaintext", async () => {
    const res = await request(app.getHttpServer())
      .post("/accounts").set("Cookie", cookie).send(body).expect(201);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("IGQVJ-plaintext-token");
    expect(serialized).not.toContain("accessTokenEncrypted");
  });

  it("lists created accounts", async () => {
    await request(app.getHttpServer()).post("/accounts").set("Cookie", cookie).send(body).expect(201);
    const res = await request(app.getHttpServer()).get("/accounts").set("Cookie", cookie).expect(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 404 for an unknown account", async () => {
    await request(app.getHttpServer()).get("/accounts/nope").set("Cookie", cookie).expect(404);
  });

  it("rejects an invalid body with 400", async () => {
    await request(app.getHttpServer())
      .post("/accounts").set("Cookie", cookie)
      .send({ ...body, tokenExpiresAt: "soon" }).expect(400);
  });

  it("toggles dryRun via PATCH", async () => {
    const created = await request(app.getHttpServer())
      .post("/accounts").set("Cookie", cookie).send(body).expect(201);
    const patched = await request(app.getHttpServer())
      .patch(`/accounts/${created.body.id}`).set("Cookie", cookie)
      .send({ dryRun: false }).expect(200);
    expect(patched.body.dryRun).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/accounts.e2e.test.ts`
Expected: FAIL — 404 on `POST /accounts` (no controller registered).

- [ ] **Step 3: Implement the controller and module**

`apps/api/src/accounts/accounts.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Account, AccountStatus } from "@intabot/shared";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import { AccountNotFoundError, AccountRepository } from "./account.repository";

const CreateBody = z.object({
  name: z.string().min(1),
  igUserId: z.string().min(1),
  username: z.string().min(1),
  accessToken: z.string().min(1),
  tokenExpiresAt: z.string().datetime(),
});

const PatchBody = z.object({
  name: z.string().min(1).optional(),
  status: AccountStatus.optional(),
  dryRun: z.boolean().optional(),
  moderationPaused: z.boolean().optional(),
});

export type AccountView = Omit<Account, "accessTokenEncrypted">;

function toView(account: Account): AccountView {
  const { accessTokenEncrypted: _omitted, ...view } = account;
  return view;
}

@Controller("accounts")
@UseGuards(AuthGuard)
export class AccountsController {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly crypto: TokenCryptoService,
  ) {}

  @Get()
  async list(): Promise<AccountView[]> {
    return (await this.accounts.list()).map(toView);
  }

  @Get(":id")
  async get(@Param("id") id: string): Promise<AccountView> {
    const account = await this.accounts.get(id);
    if (!account) throw new NotFoundException(`account not found: ${id}`);
    return toView(account);
  }

  @Post()
  async create(@Body() body: unknown): Promise<AccountView> {
    const parsed = CreateBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const account = await this.accounts.create({
      name: parsed.data.name,
      igUserId: parsed.data.igUserId,
      username: parsed.data.username,
      accessTokenEncrypted: this.crypto.encrypt(parsed.data.accessToken),
      tokenExpiresAt: parsed.data.tokenExpiresAt,
    });
    return toView(account);
  }

  @Patch(":id")
  async patch(@Param("id") id: string, @Body() body: unknown): Promise<AccountView> {
    const parsed = PatchBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    try {
      return toView(await this.accounts.update(id, parsed.data));
    } catch (err) {
      if (err instanceof AccountNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}
```

`apps/api/src/accounts/accounts.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { AccountRepository } from "./account.repository";
import { AccountsController } from "./accounts.controller";

@Module({
  controllers: [AccountsController],
  providers: [AccountRepository],
  exports: [AccountRepository],
})
export class AccountsModule {}
```

Add `AccountsModule` to `AppModule`'s `imports`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/test/accounts.e2e.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add authenticated account REST endpoints"
```

---

## Task 11: Dashboard shell

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`
- Create: `apps/web/app/login/page.tsx`, `apps/web/app/login/actions.ts`
- Create: `apps/web/app/(dashboard)/layout.tsx`, `apps/web/app/(dashboard)/page.tsx`
- Create: `apps/web/lib/http.ts`, `apps/web/lib/api.ts`
- Test: `apps/web/lib/http.test.ts`

**Interfaces:**
- Consumes: the API endpoints from Tasks 9 and 10
- Produces:
  - `lib/http.ts` (pure, no Next.js imports — this is what the unit test loads):
    `ApiError` with a `status` field, `buildUrl(base, path)`, `parseResponse<T>(res)`, `API_BASE_URL`
  - `lib/api.ts` (server-only): `apiFetch<T>(path, init?)` — forwards the session cookie from the incoming request; `getAccounts(): Promise<AccountView[]>`; `getMe(): Promise<{ email: string } | null>`; type `AccountView`

- [ ] **Step 1: Scaffold the Next.js app**

`apps/web/package.json`:

```json
{
  "name": "@intabot/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000"
  },
  "dependencies": {
    "@intabot/shared": "workspace:*",
    "next": "15.1.4",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/react": "19.0.2",
    "@types/react-dom": "19.0.2"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]
}
```

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  env: { API_BASE_URL: process.env.API_BASE_URL ?? "http://localhost:3001" },
};

export default config;
```

- [ ] **Step 2: Write the failing API client test**

The test targets `lib/http.ts` rather than `lib/api.ts` deliberately: `api.ts`
imports `next/headers`, which only works inside a Next.js request context. Keeping
the pure helpers in a separate module makes them unit-testable under plain Node.

`apps/web/lib/http.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, buildUrl, parseResponse } from "./http";

afterEach(() => { vi.restoreAllMocks(); });

describe("buildUrl", () => {
  it("joins the base and path without doubling slashes", () => {
    expect(buildUrl("http://localhost:3001", "/accounts")).toBe("http://localhost:3001/accounts");
    expect(buildUrl("http://localhost:3001/", "/accounts")).toBe("http://localhost:3001/accounts");
  });
});

describe("parseResponse", () => {
  it("returns the parsed body on 200", async () => {
    const res = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await expect(parseResponse<{ ok: boolean }>(res)).resolves.toEqual({ ok: true });
  });

  it("throws ApiError carrying the status on 401", async () => {
    const res = new Response("{}", { status: 401 });
    await expect(parseResponse(res)).rejects.toMatchObject({ status: 401 });
  });

  it("throws ApiError on 500", async () => {
    const res = new Response("boom", { status: 500 });
    await expect(parseResponse(res)).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/web/lib/http.test.ts`
Expected: FAIL — cannot resolve `./http`.

Add `"apps/web"` to `vitest.workspace.ts`.

- [ ] **Step 4: Implement the pure HTTP helpers and the server-side client**

`apps/web/lib/http.ts`:

```ts
export const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function buildUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, `API request failed with ${res.status}`);
  return (await res.json()) as T;
}
```

`apps/web/lib/api.ts`:

```ts
import { cookies } from "next/headers";
import { API_BASE_URL, ApiError, buildUrl, parseResponse } from "./http";

export { ApiError } from "./http";

/** Server-side fetch that forwards the operator's session cookie. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(buildUrl(API_BASE_URL, path), {
    ...init,
    headers: { "content-type": "application/json", cookie: cookieHeader, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  return parseResponse<T>(res);
}

export interface AccountView {
  id: string;
  name: string;
  igUserId: string;
  username: string;
  status: "ACTIVE" | "DEGRADED" | "DISABLED";
  dryRun: boolean;
  moderationPaused: boolean;
  tokenExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export async function getAccounts(): Promise<AccountView[]> {
  return apiFetch<AccountView[]>("/accounts");
}

export async function getMe(): Promise<{ email: string } | null> {
  try {
    return await apiFetch<{ email: string }>("/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
```

- [ ] **Step 5: Run the client test to verify it passes**

Run: `pnpm vitest run apps/web/lib/http.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Build the login page**

`apps/web/app/globals.css`:

```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 2rem; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #8883; }
form { display: grid; gap: 0.75rem; max-width: 20rem; }
input, button { padding: 0.5rem; font: inherit; }
.error { color: #c0392b; }
```

`apps/web/app/layout.tsx`:

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "IntaBot" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/app/login/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_BASE_URL, buildUrl } from "@/lib/http";

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  const res = await fetch(buildUrl(API_BASE_URL, "/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    }),
  });

  if (!res.ok) return "Invalid email or password.";

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const [pair] = setCookie.split(";");
    const [name, ...rest] = (pair ?? "").split("=");
    if (name) {
      (await cookies()).set(name, rest.join("="), { httpOnly: true, sameSite: "lax", path: "/" });
    }
  }

  redirect("/");
}
```

`apps/web/app/login/page.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, null);

  return (
    <main>
      <h1>IntaBot</h1>
      <form action={formAction}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Build the dashboard shell**

`apps/web/app/(dashboard)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/api";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");

  return (
    <main>
      <header>
        <h1>IntaBot</h1>
        <p>Signed in as {me.email}</p>
      </header>
      {children}
    </main>
  );
}
```

`apps/web/app/(dashboard)/page.tsx`:

```tsx
import { getAccounts } from "@/lib/api";

export default async function AccountsPage() {
  const accounts = await getAccounts();

  if (accounts.length === 0) {
    return <p>No accounts connected yet.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th><th>Username</th><th>Status</th><th>Dry run</th><th>Token expires</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => (
          <tr key={account.id}>
            <td>{account.name}</td>
            <td>@{account.username}</td>
            <td>{account.status}</td>
            <td>{account.dryRun ? "on" : "off"}</td>
            <td>{new Date(account.tokenExpiresAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 8: Verify the dashboard manually**

```bash
pnpm infra:up
pnpm --filter @intabot/api run start:dev   # terminal 1
pnpm --filter @intabot/web run dev         # terminal 2
```

Open `http://localhost:3000`. Expected: redirect to `/login`; signing in with the operator created in Task 9 shows the (empty) accounts table.

- [ ] **Step 9: Commit**

```bash
git add apps/web vitest.workspace.ts
git commit -m "feat(web): add dashboard shell with login and account list"
```

---

## Task 12: Full-stack smoke test and developer documentation

**Files:**
- Create: `apps/api/test/phase1-smoke.e2e.test.ts`
- Create: `README.md`
- Modify: `package.json` (add a `dev` script)

**Interfaces:**
- Consumes: everything from Tasks 1–11
- Produces: a single test proving the Phase 1 slice works end to end, and a README that gets a new developer running

- [ ] **Step 1: Write the failing smoke test**

`apps/api/test/phase1-smoke.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

describe("phase 1 smoke", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    app.get(FakeInstagramAdapter).reset();
  });

  afterAll(async () => { await app.close(); });

  it("runs the whole slice: login, create account, draft a post, publish it through the fake", async () => {
    // 1. Provision an operator and log in.
    await app.get(UserRepository).create("operator@example.com", await app.get(PasswordService).hash("s3cret"));
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" })
      .expect(200);
    const cookie = login.headers["set-cookie"]!;

    // 2. Create an account through the REST surface.
    const created = await request(app.getHttpServer())
      .post("/accounts").set("Cookie", cookie)
      .send({
        name: "Studio Nord",
        igUserId: "17841400000000000",
        username: "studionord",
        accessToken: "IGQVJ-plaintext-token",
        tokenExpiresAt: "2026-10-13T00:00:00.000Z",
      })
      .expect(201);
    const accountId = created.body.id as string;

    // 3. Draft a post and walk it through the approval states.
    const posts = app.get(PostRepository);
    const draft = await posts.create({
      accountId,
      format: "IMAGE",
      mediaAssetIds: ["asset-1"],
      caption: "Morning light.",
      hashtags: ["#studio"],
      scheduledAt: "2026-08-15T09:00:00.000Z",
    });

    const pending = await posts.transition({
      accountId, postId: draft.id,
      expectedStatus: "DRAFT", expectedVersion: draft.version, nextStatus: "PENDING_APPROVAL",
    });
    expect(await posts.listByStatus(accountId, "PENDING_APPROVAL")).toHaveLength(1);

    const approved = await posts.transition({
      accountId, postId: draft.id,
      expectedStatus: "PENDING_APPROVAL", expectedVersion: pending.version, nextStatus: "APPROVED",
    });

    // 4. Publish through the fake Instagram adapter.
    const instagram = app.get(FakeInstagramAdapter);
    instagram.setProcessingPolls(1);

    const account = { ...created.body, accessTokenEncrypted: "v1:a:b:c" };
    const { containerId } = await instagram.createContainer(account, {
      format: "IMAGE", mediaUrl: "https://example.test/a.jpg", caption: approved.caption,
    });

    const publishing = await posts.transition({
      accountId, postId: draft.id,
      expectedStatus: "APPROVED", expectedVersion: approved.version,
      nextStatus: "PUBLISHING", patch: { containerId },
    });

    expect(await instagram.getContainerStatus(account, containerId)).toBe("IN_PROGRESS");
    expect(await instagram.getContainerStatus(account, containerId)).toBe("FINISHED");

    const result = await instagram.publishContainer(account, containerId);
    const published = await posts.transition({
      accountId, postId: draft.id,
      expectedStatus: "PUBLISHING", expectedVersion: publishing.version,
      nextStatus: "PUBLISHED", patch: { igMediaId: result.igMediaId, permalink: result.permalink },
    });

    // 5. Assert the end state.
    expect(published.status).toBe("PUBLISHED");
    expect(published.permalink).toContain("instagram.test");
    expect(instagram.getPublished()).toHaveLength(1);
    expect(await posts.listByStatus(accountId, "PENDING_APPROVAL")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm infra:up && pnpm vitest run apps/api/test/phase1-smoke.e2e.test.ts`
Expected: PASS. If it fails, the failure identifies which earlier task's contract drifted — fix that task's code, not this test.

- [ ] **Step 3: Run the entire suite**

Run: `pnpm test`
Expected: every test from Tasks 1–12 passes.

- [ ] **Step 4: Write the README**

`README.md`:

````markdown
# IntaBot

Self-hosted agentic Instagram management for a small number of Business accounts.

- Design: `docs/superpowers/specs/2026-08-14-intabot-design.md`
- Meta setup notes: `docs/meta-setup.md`

## Requirements

- Node.js 22+
- pnpm 9.15+
- Docker (for DynamoDB Local, Redis, MinIO)

## First run

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# paste the output into TOKEN_ENCRYPTION_KEY in .env

pnpm install
pnpm infra:up
pnpm test                       # creates the tables as a side effect
pnpm --filter @intabot/api run create-user you@example.com <password>
```

## Development

```bash
pnpm --filter @intabot/api run start:dev   # API on :3001
pnpm --filter @intabot/web run dev         # dashboard on :3000
```

## Tests

```bash
pnpm test          # everything (requires `pnpm infra:up`)
pnpm test:watch
```

Integration tests run against DynamoDB Local. All Instagram calls go through
`FakeInstagramAdapter`; no Meta credentials are needed to run the suite.

## Phase status

- [x] Phase 0 — Meta app setup
- [x] Phase 1 — foundation (this repo)
- [ ] Phase 2 — Content Agent
- [ ] Phase 3 — Moderation Agent
- [ ] Phase 4 — Analytics
- [ ] Phase 5 — hardening and deploy
````

- [ ] **Step 5: Add a convenience dev script**

Add to the root `package.json` scripts:

```json
"dev": "pnpm --parallel --filter @intabot/api --filter @intabot/web run dev"
```

Rename the API's `start:dev` script to also be available as `dev`:

```json
"dev": "nest start --watch"
```

- [ ] **Step 6: Commit**

```bash
git add README.md package.json apps/api
git commit -m "test: add phase 1 full-stack smoke test and developer README"
```

---

## Definition of done for Phase 1

- `pnpm infra:up && pnpm test` is green from a clean clone.
- An operator can be created from the CLI, log in at `http://localhost:3000`, and see the accounts table.
- An account can be created through the API with a plaintext token; the token is encrypted at rest and appears in no API response.
- A post can be walked `DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHING → PUBLISHED`, and two concurrent identical transitions produce exactly one winner.
- Every Instagram interaction runs through `InstagramPort`; no code outside `apps/api/src/instagram/` knows Instagram exists.
- `docs/meta-setup.md` records the verified API version, permission strings, and account IDs from Task 0.
