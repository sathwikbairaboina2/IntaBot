# IntaBot Phase 2 — Content Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the upload → draft → approve → schedule → publish loop, fully exercisable in dry-run mode with no Meta and no Anthropic credentials.

**Architecture:** Media uploads land in MinIO behind a `MediaStoragePort` and enqueue a drafting job. A short LangGraph flow calls `CopyWriterPort` for caption text and `SlotPlanner` for a posting time, then writes a `PENDING_APPROVAL` post. Approval is a REST call guarded by the Phase 1 version check; a repeatable scan enqueues due posts; the publish job claims the post *before* creating an Instagram container, so retries can never double-post.

**Tech Stack:** BullMQ 5 + ioredis (queues), `@aws-sdk/client-s3` + `s3-request-presigner` (MinIO), `@langchain/langgraph` (drafting flow), `@anthropic-ai/sdk` (real copy writer), `date-fns-tz` (slot arithmetic), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-intabot-phase-2-content-agent-design.md` (extends `2026-08-14-intabot-design.md`)

## Global Constraints

- **Every dependency is injected with an explicit `@Inject(Token)`.** esbuild — which Vitest and tsx use — does not implement `emitDecoratorMetadata`, so type-based Nest injection silently resolves to `undefined`. This bit us repeatedly in Phase 1.
- **Every task's verification runs `pnpm typecheck` as well as the tests.** Phase 1 shipped four type errors that stayed green for nine tasks because Vitest strips types rather than checking them.
- **Never chain a commit behind a grepped test run.** Run the suite, read the result, *then* commit as a separate command. Two red commits landed in Phase 1 this way.
- **Ports get fakes.** No test may require `ANTHROPIC_API_KEY`, Meta credentials, or network access.
- **Test isolation is per Vitest worker.** DynamoDB tables already use `VITEST_WORKER_ID`; BullMQ queues take the same treatment from their first test.
- **Claim before side effect.** Any job with an external side effect performs its conditional status transition first.
- Host ports on this machine: API 4000, dashboard 3100, DynamoDB 8200, Redis 6479, MinIO 9200/9201.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/shared/src/schemas/*.ts` | Optional field additions to Post, MediaAsset, Account |
| `apps/api/src/jobs/queue.constants.ts` | Queue names and the per-worker prefix helper |
| `apps/api/src/jobs/jobs.module.ts` | Redis connection, `Queue` providers, worker bootstrap |
| `apps/api/src/media/media-storage.port.ts` | `MediaStoragePort` interface + token |
| `apps/api/src/media/minio-storage.adapter.ts` | S3-compatible implementation |
| `apps/api/src/media/media-asset.repository.ts` | MediaAsset persistence |
| `apps/api/src/media/media.controller.ts` | `POST /media` upload |
| `apps/api/src/content/copy-writer.port.ts` | `CopyWriterPort` interface + DTOs + token |
| `apps/api/src/content/fake-copy-writer.ts` | Deterministic implementation for tests |
| `apps/api/src/content/anthropic-copy-writer.ts` | Real implementation (`claude-opus-5`) |
| `apps/api/src/content/slot-planner.ts` | Pure slot arithmetic |
| `apps/api/src/content/drafting.graph.ts` | Three-node LangGraph flow |
| `apps/api/src/jobs/draft.processor.ts` | Draft queue worker |
| `apps/api/src/jobs/publish-scan.processor.ts` | Repeatable due-post scan |
| `apps/api/src/jobs/publish.processor.ts` | Claim + create container |
| `apps/api/src/jobs/poll-container.processor.ts` | Poll, publish or fail |
| `apps/api/src/approvals/approvals.controller.ts` | Approval queue REST |
| `apps/web/app/(dashboard)/upload/page.tsx` | Upload screen |
| `apps/web/app/(dashboard)/approvals/page.tsx` | Approval queue screen |

---

## Task 1: Schema additions

**Files:**
- Modify: `packages/shared/src/schemas/post.ts`, `media-asset.ts`, `account.ts`
- Test: `packages/shared/src/schemas/schemas.test.ts`

**Interfaces:**
- Consumes: the Phase 1 schemas
- Produces: `Post.needsAttention?`, `Post.altText?`, `Post.dryRun?`; `MediaAsset.draftFailed?`; `Account.voice?`, `Account.timezone` (default `"UTC"`), `Account.postingWindows` (default `["09:00","12:30","18:00"]`)

- [ ] **Step 1: Add the failing tests**

Append to `packages/shared/src/schemas/schemas.test.ts`:

```ts
import { AccountSchema, MediaAssetSchema, PostSchema } from "../index.js";

describe("phase 2 schema additions", () => {
  const account = {
    id: "acct-1", name: "Studio Nord", igUserId: "1784140", username: "studionord",
    status: "ACTIVE", accessTokenEncrypted: "v1:a:b:c",
    tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z",
  };

  it("defaults timezone to UTC and gives three posting windows", () => {
    const parsed = AccountSchema.parse(account);
    expect(parsed.timezone).toBe("UTC");
    expect(parsed.postingWindows).toEqual(["09:00", "12:30", "18:00"]);
  });

  it("accepts an explicit voice, timezone and windows", () => {
    const parsed = AccountSchema.parse({
      ...account, voice: "warm, plain", timezone: "Europe/Berlin", postingWindows: ["08:00"],
    });
    expect(parsed.timezone).toBe("Europe/Berlin");
    expect(parsed.postingWindows).toEqual(["08:00"]);
  });

  it("rejects a malformed posting window", () => {
    expect(() => AccountSchema.parse({ ...account, postingWindows: ["9am"] })).toThrow();
  });

  it("accepts the new optional post fields", () => {
    const parsed = PostSchema.parse({
      id: "p1", accountId: "acct-1", status: "PENDING_APPROVAL", format: "IMAGE",
      version: 1, mediaAssetIds: ["a1"], caption: "", hashtags: [],
      scheduledAt: "2026-08-16T09:00:00.000Z",
      createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z",
      needsAttention: true, altText: "A studio at dawn", dryRun: true,
    });
    expect(parsed.needsAttention).toBe(true);
    expect(parsed.altText).toBe("A studio at dawn");
  });

  it("accepts draftFailed on a media asset", () => {
    const parsed = MediaAssetSchema.parse({
      id: "a1", accountId: "acct-1", storageKey: "acct-1/a1.jpg",
      contentType: "image/jpeg", sizeBytes: 1024,
      createdAt: "2026-08-15T00:00:00.000Z", draftFailed: true,
    });
    expect(parsed.draftFailed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/shared/src/schemas/schemas.test.ts`
Expected: FAIL — `timezone` is `undefined`, `postingWindows` is `undefined`.

- [ ] **Step 3: Add the fields**

In `packages/shared/src/schemas/post.ts`, add inside `PostSchema` before `createdAt`:

```ts
  altText: z.string().optional(),
  needsAttention: z.boolean().optional(),
  dryRun: z.boolean().optional(),
```

In `packages/shared/src/schemas/media-asset.ts`, add before `createdAt`:

```ts
  draftFailed: z.boolean().optional(),
```

In `packages/shared/src/schemas/account.ts`, add before `createdAt`:

```ts
  voice: z.string().optional(),
  timezone: z.string().min(1).default("UTC"),
  postingWindows: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm"))
    .default(["09:00", "12:30", "18:00"]),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run packages/shared` then `pnpm typecheck`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add phase 2 fields for drafting, slots and dry run"
```

---

## Task 2: Queue infrastructure

**Files:**
- Create: `apps/api/src/jobs/queue.constants.ts`, `apps/api/src/jobs/jobs.module.ts`
- Create: `apps/api/test/queue-fixture.ts`
- Test: `apps/api/src/jobs/queue.constants.test.ts`, `apps/api/test/queue-smoke.e2e.test.ts`

**Interfaces:**
- Consumes: `AppConfigService.redisUrl`
- Produces:
  - `QUEUE = { draft: "draft", publishScan: "publish-scan", publish: "publish", pollContainer: "poll-container" } as const`
  - `queuePrefix(): string` — `"intabot"`, or `"intabot-test-w<N>"` when `VITEST_WORKER_ID` is set
  - Injection tokens `DRAFT_QUEUE`, `PUBLISH_SCAN_QUEUE`, `PUBLISH_QUEUE`, `POLL_QUEUE`, each providing a BullMQ `Queue`
  - `REDIS_CONNECTION` token providing an `IORedis` instance

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter @intabot/api add bullmq@5.34.0 ioredis@5.4.1
```

- [ ] **Step 2: Write the failing prefix test**

`apps/api/src/jobs/queue.constants.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { QUEUE, queuePrefix } from "./queue.constants";

const original = process.env.VITEST_WORKER_ID;
afterEach(() => {
  if (original === undefined) delete process.env.VITEST_WORKER_ID;
  else process.env.VITEST_WORKER_ID = original;
});

describe("queuePrefix", () => {
  it("isolates queues per vitest worker", () => {
    process.env.VITEST_WORKER_ID = "3";
    expect(queuePrefix()).toBe("intabot-test-w3");
  });

  it("uses the plain prefix outside tests", () => {
    delete process.env.VITEST_WORKER_ID;
    expect(queuePrefix()).toBe("intabot");
  });
});

describe("QUEUE", () => {
  it("names all four queues", () => {
    expect(Object.values(QUEUE)).toEqual(["draft", "publish-scan", "publish", "poll-container"]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/jobs/queue.constants.test.ts`
Expected: FAIL — cannot resolve `./queue.constants`.

- [ ] **Step 4: Implement the constants**

`apps/api/src/jobs/queue.constants.ts`:

```ts
export const QUEUE = {
  draft: "draft",
  publishScan: "publish-scan",
  publish: "publish",
  pollContainer: "poll-container",
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/**
 * Redis is shared state. Prefixing per Vitest worker keeps concurrent test
 * files from consuming each other's jobs, the same way DynamoDB table names
 * are scoped by VITEST_WORKER_ID.
 */
export function queuePrefix(): string {
  const worker = process.env.VITEST_WORKER_ID;
  return worker ? `intabot-test-w${worker}` : "intabot";
}

export const REDIS_CONNECTION = Symbol("REDIS_CONNECTION");
export const DRAFT_QUEUE = Symbol("DRAFT_QUEUE");
export const PUBLISH_SCAN_QUEUE = Symbol("PUBLISH_SCAN_QUEUE");
export const PUBLISH_QUEUE = Symbol("PUBLISH_QUEUE");
export const POLL_QUEUE = Symbol("POLL_QUEUE");
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run apps/api/src/jobs/queue.constants.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing queue round-trip test**

`apps/api/test/queue-fixture.ts`:

```ts
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { queuePrefix } from "../src/jobs/queue.constants";

export const testConnection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

export function testQueue(name: string): Queue {
  return new Queue(name, { connection: testConnection, prefix: queuePrefix() });
}

/** Removes every job from the named queues. Call in beforeEach. */
export async function drainQueues(names: string[]): Promise<void> {
  for (const name of names) {
    const q = testQueue(name);
    await q.obliterate({ force: true });
    await q.close();
  }
}
```

`apps/api/test/queue-smoke.e2e.test.ts`:

```ts
import { Worker } from "bullmq";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QUEUE, queuePrefix } from "../src/jobs/queue.constants";
import { drainQueues, testConnection, testQueue } from "./queue-fixture";

describe("queue infrastructure", () => {
  let worker: Worker | undefined;

  beforeEach(async () => { await drainQueues([QUEUE.draft]); });
  afterEach(async () => { await worker?.close(); worker = undefined; });

  it("delivers a job to a worker on the same prefix", async () => {
    const seen: string[] = [];
    worker = new Worker(
      QUEUE.draft,
      async (job) => { seen.push(job.data.assetId as string); },
      { connection: testConnection, prefix: queuePrefix() },
    );

    const q = testQueue(QUEUE.draft);
    await q.add("draft", { assetId: "asset-1" });
    await q.close();

    await new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = setInterval(() => {
        if (seen.length > 0 || Date.now() - started > 10_000) {
          clearInterval(tick);
          resolve();
        }
      }, 50);
    });

    expect(seen).toEqual(["asset-1"]);
  });

  it("dedupes jobs sharing a jobId", async () => {
    const q = testQueue(QUEUE.draft);
    await q.add("draft", { assetId: "a" }, { jobId: "same" });
    await q.add("draft", { assetId: "a" }, { jobId: "same" });
    expect(await q.getWaitingCount()).toBe(1);
    await q.close();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm infra:up` then `pnpm vitest run apps/api/test/queue-smoke.e2e.test.ts`
Expected: FAIL — cannot resolve `./queue-fixture`'s import of `../src/jobs/queue.constants` only if Step 4 was skipped; otherwise the test fails because the fixture file does not exist yet. Create the fixture as written in Step 6, then this passes.

- [ ] **Step 8: Wire the Nest module**

`apps/api/src/jobs/jobs.module.ts`:

```ts
import { Global, Module, OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { AppConfigService } from "../config/config.service";
import {
  DRAFT_QUEUE, POLL_QUEUE, PUBLISH_QUEUE, PUBLISH_SCAN_QUEUE,
  QUEUE, REDIS_CONNECTION, queuePrefix,
} from "./queue.constants";

function queueProvider(token: symbol, name: string) {
  return {
    provide: token,
    inject: [REDIS_CONNECTION],
    useFactory: (connection: IORedis) =>
      new Queue(name, { connection, prefix: queuePrefix() }),
  };
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [AppConfigService],
      // maxRetriesPerRequest must be null or BullMQ workers refuse to start.
      useFactory: (config: AppConfigService) =>
        new IORedis(config.redisUrl, { maxRetriesPerRequest: null }),
    },
    queueProvider(DRAFT_QUEUE, QUEUE.draft),
    queueProvider(PUBLISH_SCAN_QUEUE, QUEUE.publishScan),
    queueProvider(PUBLISH_QUEUE, QUEUE.publish),
    queueProvider(POLL_QUEUE, QUEUE.pollContainer),
  ],
  exports: [REDIS_CONNECTION, DRAFT_QUEUE, PUBLISH_SCAN_QUEUE, PUBLISH_QUEUE, POLL_QUEUE],
})
export class JobsModule {}
```

Add `JobsModule` to `AppModule`'s `imports`.

- [ ] **Step 9: Run the queue tests and typecheck**

Run: `pnpm vitest run apps/api/test/queue-smoke.e2e.test.ts`
Expected: PASS, 2 tests.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): add BullMQ queue infrastructure with per-worker prefixes"
```

---

## Task 3: Media storage port and asset repository

**Files:**
- Create: `apps/api/src/media/media-storage.port.ts`, `minio-storage.adapter.ts`, `media-asset.repository.ts`, `media.module.ts`
- Test: `apps/api/src/media/minio-storage.adapter.test.ts`, `apps/api/src/media/media-asset.repository.test.ts`

**Interfaces:**
- Consumes: `AppConfigService.s3`, `DYNAMO_DOC`, `keys.mediaAsset`, `MediaAssetSchema`
- Produces:
  - `MEDIA_STORAGE` token; `MediaStoragePort` with `put(key, body, contentType)` and `presignedUrl(key, ttlSeconds)`
  - `MediaAssetRepository.create(input): Promise<MediaAsset>`, `.get(accountId, assetId)`, `.markDraftFailed(accountId, assetId)`

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter @intabot/api add @aws-sdk/client-s3@3.716.0 @aws-sdk/s3-request-presigner@3.716.0
```

- [ ] **Step 2: Write the failing storage test**

`apps/api/src/media/minio-storage.adapter.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { MinioStorageAdapter } from "./minio-storage.adapter";

const s3 = {
  endpoint: process.env.S3_ENDPOINT!,
  bucket: process.env.S3_BUCKET!,
  accessKey: process.env.S3_ACCESS_KEY!,
  secretKey: process.env.S3_SECRET_KEY!,
};

const adapter = new MinioStorageAdapter(s3);

describe("MinioStorageAdapter", () => {
  beforeAll(async () => { await adapter.ensureBucket(); });

  it("stores and reads back an object", async () => {
    const key = `test/${Date.now()}-a.txt`;
    await adapter.put(key, Buffer.from("hello"), "text/plain");
    const url = await adapter.presignedUrl(key, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("issues a presigned URL pointing at the configured bucket", async () => {
    const url = await adapter.presignedUrl("some/key.jpg", 60);
    expect(url).toContain(s3.bucket);
    expect(url).toContain("X-Amz-Signature");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/media/minio-storage.adapter.test.ts`
Expected: FAIL — cannot resolve `./minio-storage.adapter`.

- [ ] **Step 4: Implement the port and adapter**

`apps/api/src/media/media-storage.port.ts`:

```ts
export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

export interface MediaStoragePort {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  presignedUrl(key: string, ttlSeconds: number): Promise<string>;
}
```

`apps/api/src/media/minio-storage.adapter.ts`:

```ts
import {
  CreateBucketCommand, GetObjectCommand, HeadBucketCommand,
  PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import type { MediaStoragePort } from "./media-storage.port";

export interface S3Settings {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

@Injectable()
export class MinioStorageAdapter implements MediaStoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(AppConfigService) settingsOrConfig: AppConfigService | S3Settings) {
    const s3 = "s3" in settingsOrConfig ? settingsOrConfig.s3 : settingsOrConfig;
    this.bucket = s3.bucket;
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: "us-east-1",
      // MinIO serves buckets as a path segment, not a subdomain.
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async presignedUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }
}
```

- [ ] **Step 5: Run the storage test**

Run: `pnpm vitest run apps/api/src/media/minio-storage.adapter.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Write the failing repository test**

`apps/api/src/media/media-asset.repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { docClient, resetTables, tableMain } from "../../test/dynamo-fixture";
import { MediaAssetRepository } from "./media-asset.repository";

const repo = new MediaAssetRepository(docClient, tableMain);

const input = {
  accountId: "acct-1",
  storageKey: "acct-1/a1.jpg",
  contentType: "image/jpeg",
  sizeBytes: 2048,
};

describe("MediaAssetRepository", () => {
  beforeEach(async () => { await resetTables(); });

  it("creates an asset with a generated id", async () => {
    const asset = await repo.create(input);
    expect(asset.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(asset.draftFailed).toBeUndefined();
  });

  it("reads an asset back", async () => {
    const created = await repo.create(input);
    expect((await repo.get("acct-1", created.id))?.storageKey).toBe("acct-1/a1.jpg");
  });

  it("returns null for an unknown asset", async () => {
    expect(await repo.get("acct-1", "nope")).toBeNull();
  });

  it("marks an asset as failed to draft", async () => {
    const created = await repo.create(input);
    await repo.markDraftFailed("acct-1", created.id);
    expect((await repo.get("acct-1", created.id))?.draftFailed).toBe(true);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/media/media-asset.repository.test.ts`
Expected: FAIL — cannot resolve `./media-asset.repository`.

- [ ] **Step 8: Implement the repository and module**

`apps/api/src/media/media-asset.repository.ts`:

```ts
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { MediaAsset, MediaAssetSchema } from "@intabot/shared";
import { ulid } from "ulid";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export interface CreateMediaAssetInput {
  accountId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  widthPx?: number;
  heightPx?: number;
  durationSeconds?: number;
}

@Injectable()
export class MediaAssetRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async create(input: CreateMediaAssetInput): Promise<MediaAsset> {
    const asset = MediaAssetSchema.parse({
      id: ulid(),
      ...input,
      createdAt: new Date().toISOString(),
    });
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...keys.mediaAsset(asset.accountId, asset.id), ...asset },
      }),
    );
    return asset;
  }

  async get(accountId: string, assetId: string): Promise<MediaAsset | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.mediaAsset(accountId, assetId) }),
    );
    return out.Item ? MediaAssetSchema.parse(out.Item) : null;
  }

  async markDraftFailed(accountId: string, assetId: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: keys.mediaAsset(accountId, assetId),
        UpdateExpression: "SET #draftFailed = :true",
        ExpressionAttributeNames: { "#draftFailed": "draftFailed" },
        ExpressionAttributeValues: { ":true": true },
      }),
    );
  }
}
```

`apps/api/src/media/media.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { MediaAssetRepository } from "./media-asset.repository";
import { MEDIA_STORAGE } from "./media-storage.port";
import { MinioStorageAdapter } from "./minio-storage.adapter";

@Module({
  providers: [
    MediaAssetRepository,
    MinioStorageAdapter,
    { provide: MEDIA_STORAGE, useExisting: MinioStorageAdapter },
  ],
  exports: [MediaAssetRepository, MEDIA_STORAGE, MinioStorageAdapter],
})
export class MediaModule {}
```

Add `MediaModule` to `AppModule`'s `imports`.

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm vitest run apps/api/src/media`
Expected: PASS, 6 tests.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): add media storage port, MinIO adapter and asset repository"
```

---

## Task 4: Upload endpoint

**Files:**
- Create: `apps/api/src/media/media.controller.ts`, `apps/api/src/media/upload.validation.ts`
- Modify: `apps/api/src/media/media.module.ts`
- Test: `apps/api/src/media/upload.validation.test.ts`, `apps/api/test/upload.e2e.test.ts`

**Interfaces:**
- Consumes: `MediaAssetRepository`, `MEDIA_STORAGE`, `DRAFT_QUEUE`, `AuthGuard`
- Produces:
  - `inferFormat(contentType: string): PostFormat | null`
  - `validateUpload(file): { ok: true; format: PostFormat } | { ok: false; reason: string }`
  - `POST /media` (multipart field `file`, body field `accountId`) → `202 { assetId, format }`

- [ ] **Step 1: Install multer types**

```bash
pnpm --filter @intabot/api add -D @types/multer@1.4.12
```

- [ ] **Step 2: Write the failing validation test**

`apps/api/src/media/upload.validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, inferFormat, validateUpload } from "./upload.validation";

describe("inferFormat", () => {
  it("maps images to IMAGE and video to REEL", () => {
    expect(inferFormat("image/jpeg")).toBe("IMAGE");
    expect(inferFormat("image/png")).toBe("IMAGE");
    expect(inferFormat("video/mp4")).toBe("REEL");
  });

  it("returns null for unsupported types", () => {
    expect(inferFormat("application/pdf")).toBeNull();
    expect(inferFormat("image/gif")).toBeNull();
  });
});

describe("validateUpload", () => {
  const file = { mimetype: "image/jpeg", size: 1024, buffer: Buffer.alloc(1024) };

  it("accepts a small jpeg", () => {
    expect(validateUpload(file)).toEqual({ ok: true, format: "IMAGE" });
  });

  it("rejects an unsupported mime type", () => {
    const result = validateUpload({ ...file, mimetype: "application/pdf" });
    expect(result).toEqual({ ok: false, reason: "unsupported content type: application/pdf" });
  });

  it("rejects a file over the size cap", () => {
    const result = validateUpload({ ...file, size: MAX_UPLOAD_BYTES + 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateUpload({ ...file, size: 0 }).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/media/upload.validation.test.ts`
Expected: FAIL — cannot resolve `./upload.validation`.

- [ ] **Step 4: Implement validation**

`apps/api/src/media/upload.validation.ts`:

```ts
import type { PostFormat } from "@intabot/shared";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const FORMAT_BY_MIME: Record<string, PostFormat> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "video/mp4": "REEL",
  "video/quicktime": "REEL",
};

export function inferFormat(contentType: string): PostFormat | null {
  return FORMAT_BY_MIME[contentType] ?? null;
}

export interface UploadCandidate {
  mimetype: string;
  size: number;
}

export type UploadValidation =
  | { ok: true; format: PostFormat }
  | { ok: false; reason: string };

export function validateUpload(file: UploadCandidate): UploadValidation {
  const format = inferFormat(file.mimetype);
  if (!format) return { ok: false, reason: `unsupported content type: ${file.mimetype}` };
  if (file.size <= 0) return { ok: false, reason: "file is empty" };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `file exceeds ${MAX_UPLOAD_BYTES} bytes` };
  }
  return { ok: true, format };
}
```

- [ ] **Step 5: Run the validation test**

Run: `pnpm vitest run apps/api/src/media/upload.validation.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Write the failing upload endpoint test**

`apps/api/test/upload.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { AccountRepository } from "../src/accounts/account.repository";
import { QUEUE } from "../src/jobs/queue.constants";
import { resetTables } from "./dynamo-fixture";
import { drainQueues, testQueue } from "./queue-fixture";

describe("upload", () => {
  let app: INestApplication;
  let cookie: string;
  let accountId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.draft]);
    await app.get(UserRepository).create("op@example.com", await app.get(PasswordService).hash("pw"));
    const login = await request(app.getHttpServer())
      .post("/auth/login").send({ email: "op@example.com", password: "pw" });
    cookie = login.headers["set-cookie"]!;
    const account = await app.get(AccountRepository).create({
      name: "Studio Nord", igUserId: "1784140", username: "studionord",
      accessTokenEncrypted: "v1:a:b:c", tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
  });

  afterAll(async () => { await app.close(); });

  it("requires authentication", async () => {
    await request(app.getHttpServer())
      .post("/media").field("accountId", accountId)
      .attach("file", Buffer.from("x"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(401);
  });

  it("accepts a jpeg and returns an asset id", async () => {
    const res = await request(app.getHttpServer())
      .post("/media").set("Cookie", cookie).field("accountId", accountId)
      .attach("file", Buffer.from("fake-jpeg-bytes"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(202);
    expect(res.body.assetId).toBeTruthy();
    expect(res.body.format).toBe("IMAGE");
  });

  it("enqueues exactly one drafting job per upload", async () => {
    await request(app.getHttpServer())
      .post("/media").set("Cookie", cookie).field("accountId", accountId)
      .attach("file", Buffer.from("bytes"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(202);

    const q = testQueue(QUEUE.draft);
    expect(await q.getWaitingCount()).toBe(1);
    await q.close();
  });

  it("rejects an unsupported type with 400 and enqueues nothing", async () => {
    await request(app.getHttpServer())
      .post("/media").set("Cookie", cookie).field("accountId", accountId)
      .attach("file", Buffer.from("%PDF"), { filename: "a.pdf", contentType: "application/pdf" })
      .expect(400);

    const q = testQueue(QUEUE.draft);
    expect(await q.getWaitingCount()).toBe(0);
    await q.close();
  });

  it("returns 404 for an unknown account", async () => {
    await request(app.getHttpServer())
      .post("/media").set("Cookie", cookie).field("accountId", "nope")
      .attach("file", Buffer.from("bytes"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(404);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/upload.e2e.test.ts`
Expected: FAIL — 404 on `POST /media`, no controller registered.

- [ ] **Step 8: Implement the controller**

`apps/api/src/media/media.controller.ts`:

```ts
import {
  BadRequestException, Body, Controller, HttpCode, Inject,
  NotFoundException, Post, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Queue } from "bullmq";
import { AccountRepository } from "../accounts/account.repository";
import { AuthGuard } from "../auth/auth.guard";
import { DRAFT_QUEUE } from "../jobs/queue.constants";
import { MediaAssetRepository } from "./media-asset.repository";
import { MEDIA_STORAGE, type MediaStoragePort } from "./media-storage.port";
import { MAX_UPLOAD_BYTES, validateUpload } from "./upload.validation";

@Controller("media")
@UseGuards(AuthGuard)
export class MediaController {
  constructor(
    @Inject(MediaAssetRepository) private readonly assets: MediaAssetRepository,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(DRAFT_QUEUE) private readonly draftQueue: Queue,
  ) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("accountId") accountId: string | undefined,
  ) {
    if (!file) throw new BadRequestException("file is required");
    if (!accountId) throw new BadRequestException("accountId is required");

    const account = await this.accounts.get(accountId);
    if (!account) throw new NotFoundException(`account not found: ${accountId}`);

    const validation = validateUpload(file);
    if (!validation.ok) throw new BadRequestException(validation.reason);

    const key = `${accountId}/${Date.now()}-${file.originalname}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    const asset = await this.assets.create({
      accountId,
      storageKey: key,
      contentType: file.mimetype,
      sizeBytes: file.size,
    });

    await this.draftQueue.add(
      "draft",
      { accountId, assetId: asset.id, format: validation.format },
      { jobId: `draft:${asset.id}`, attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );

    return { assetId: asset.id, format: validation.format };
  }
}
```

Add `MediaController` to `MediaModule`'s `controllers` array, and import `AccountsModule` into `MediaModule` so `AccountRepository` resolves.

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm vitest run apps/api/test/upload.e2e.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): add authenticated media upload that enqueues drafting"
```

---

## Task 5: Copy writer port and fake

**Files:**
- Create: `apps/api/src/content/copy-writer.port.ts`, `fake-copy-writer.ts`, `content.module.ts`
- Test: `apps/api/src/content/fake-copy-writer.test.ts`

**Interfaces:**
- Consumes: `PostFormat` from `@intabot/shared`
- Produces:
  - `COPY_WRITER` token
  - `DraftInput = { accountVoice: string; format: PostFormat; recentCaptions: string[]; mediaMeta: { contentType: string; widthPx?: number; heightPx?: number; durationSeconds?: number } }`
  - `DraftOutput = { caption: string; hashtags: string[]; altText: string }`
  - `CopyWriterRefusalError`
  - `FakeCopyWriter` with `setNextRefusal()`, `setNextOutput(partial)`, `reset()`

- [ ] **Step 1: Write the failing test**

`apps/api/src/content/fake-copy-writer.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { CopyWriterRefusalError } from "./copy-writer.port";
import { FakeCopyWriter } from "./fake-copy-writer";

const input = {
  accountVoice: "warm, plain",
  format: "IMAGE" as const,
  recentCaptions: ["Yesterday's light."],
  mediaMeta: { contentType: "image/jpeg" },
};

describe("FakeCopyWriter", () => {
  let writer: FakeCopyWriter;
  beforeEach(() => { writer = new FakeCopyWriter(); });

  it("returns a deterministic draft", async () => {
    const a = await writer.draft(input);
    const b = await writer.draft(input);
    expect(a).toEqual(b);
    expect(a.caption.length).toBeGreaterThan(0);
    expect(a.altText.length).toBeGreaterThan(0);
  });

  it("returns hashtags without duplicates and each starting with #", async () => {
    const out = await writer.draft(input);
    expect(out.hashtags.every((h) => h.startsWith("#"))).toBe(true);
    expect(new Set(out.hashtags).size).toBe(out.hashtags.length);
  });

  it("varies the caption by format", async () => {
    const image = await writer.draft(input);
    const reel = await writer.draft({ ...input, format: "REEL" });
    expect(image.caption).not.toBe(reel.caption);
  });

  it("throws CopyWriterRefusalError when a refusal is queued", async () => {
    writer.setNextRefusal();
    await expect(writer.draft(input)).rejects.toBeInstanceOf(CopyWriterRefusalError);
  });

  it("only refuses once", async () => {
    writer.setNextRefusal();
    await expect(writer.draft(input)).rejects.toBeInstanceOf(CopyWriterRefusalError);
    await expect(writer.draft(input)).resolves.toBeTruthy();
  });

  it("honours a queued override", async () => {
    writer.setNextOutput({ caption: "Custom." });
    expect((await writer.draft(input)).caption).toBe("Custom.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/content/fake-copy-writer.test.ts`
Expected: FAIL — cannot resolve `./copy-writer.port`.

- [ ] **Step 3: Implement the port and fake**

`apps/api/src/content/copy-writer.port.ts`:

```ts
import type { PostFormat } from "@intabot/shared";

export const COPY_WRITER = Symbol("COPY_WRITER");

export interface DraftInput {
  accountVoice: string;
  format: PostFormat;
  recentCaptions: string[];
  mediaMeta: {
    contentType: string;
    widthPx?: number;
    heightPx?: number;
    durationSeconds?: number;
  };
}

export interface DraftOutput {
  caption: string;
  hashtags: string[];
  altText: string;
}

/** The model declined to produce copy. The post still reaches the queue. */
export class CopyWriterRefusalError extends Error {
  constructor(reason: string) {
    super(`copy writer refused: ${reason}`);
  }
}

export interface CopyWriterPort {
  draft(input: DraftInput): Promise<DraftOutput>;
}
```

`apps/api/src/content/fake-copy-writer.ts`:

```ts
import { Injectable } from "@nestjs/common";
import {
  CopyWriterRefusalError,
  type CopyWriterPort,
  type DraftInput,
  type DraftOutput,
} from "./copy-writer.port";

@Injectable()
export class FakeCopyWriter implements CopyWriterPort {
  private refuseNext = false;
  private override: Partial<DraftOutput> | null = null;

  setNextRefusal(): void { this.refuseNext = true; }
  setNextOutput(output: Partial<DraftOutput>): void { this.override = output; }

  reset(): void {
    this.refuseNext = false;
    this.override = null;
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    if (this.refuseNext) {
      this.refuseNext = false;
      throw new CopyWriterRefusalError("fake refusal");
    }

    const base: DraftOutput = {
      caption: `A ${input.format.toLowerCase()} from the studio.`,
      hashtags: ["#studio", "#behindthescenes"],
      altText: `Placeholder alt text for a ${input.format.toLowerCase()}.`,
    };

    const output = { ...base, ...(this.override ?? {}) };
    this.override = null;
    return output;
  }
}
```

`apps/api/src/content/content.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { COPY_WRITER } from "./copy-writer.port";
import { FakeCopyWriter } from "./fake-copy-writer";

// Phase 2 binds the fake. Task 11 adds the real adapter behind configuration.
@Module({
  providers: [FakeCopyWriter, { provide: COPY_WRITER, useExisting: FakeCopyWriter }],
  exports: [COPY_WRITER, FakeCopyWriter],
})
export class ContentModule {}
```

Add `ContentModule` to `AppModule`'s `imports`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run apps/api/src/content` then `pnpm typecheck`
Expected: 6 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add copy writer port with deterministic fake"
```

---

## Task 6: Slot planner

**Files:**
- Create: `apps/api/src/content/slot-planner.ts`
- Test: `apps/api/src/content/slot-planner.test.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `nextFreeSlot(opts: SlotOptions): string` returning an ISO instant, where
  `SlotOptions = { now: Date; timezone: string; windows: string[]; takenAt: string[]; minLeadMinutes?: number; collisionMinutes?: number }`

- [ ] **Step 1: Install the timezone helper**

```bash
pnpm --filter @intabot/api add date-fns@4.1.0 date-fns-tz@3.2.0
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/content/slot-planner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextFreeSlot } from "./slot-planner";

const windows = ["09:00", "12:30", "18:00"];

describe("nextFreeSlot", () => {
  it("picks today's next window when there is enough lead time", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T06:00:00.000Z"), // 06:00 UTC, a Monday
      timezone: "UTC", windows, takenAt: [],
    });
    expect(slot).toBe("2026-08-17T09:00:00.000Z");
  });

  it("skips a window that is inside the minimum lead time", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T08:45:00.000Z"), // 15 min before 09:00
      timezone: "UTC", windows, takenAt: [],
    });
    expect(slot).toBe("2026-08-17T12:30:00.000Z");
  });

  it("rolls to the next day after the last window", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T19:00:00.000Z"),
      timezone: "UTC", windows, takenAt: [],
    });
    expect(slot).toBe("2026-08-18T09:00:00.000Z");
  });

  it("skips a slot already taken", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T06:00:00.000Z"),
      timezone: "UTC", windows, takenAt: ["2026-08-17T09:00:00.000Z"],
    });
    expect(slot).toBe("2026-08-17T12:30:00.000Z");
  });

  it("treats a slot within the collision window as taken", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T06:00:00.000Z"),
      timezone: "UTC", windows, takenAt: ["2026-08-17T09:20:00.000Z"],
    });
    expect(slot).toBe("2026-08-17T12:30:00.000Z");
  });

  it("resolves windows in the account timezone, not UTC", () => {
    // Berlin is UTC+2 in August, so 09:00 local is 07:00Z.
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T04:00:00.000Z"),
      timezone: "Europe/Berlin", windows, takenAt: [],
    });
    expect(slot).toBe("2026-08-17T07:00:00.000Z");
  });

  it("honours a single-window configuration across days", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T06:00:00.000Z"),
      timezone: "UTC", windows: ["09:00"],
      takenAt: ["2026-08-17T09:00:00.000Z", "2026-08-18T09:00:00.000Z"],
    });
    expect(slot).toBe("2026-08-19T09:00:00.000Z");
  });

  it("throws when no free slot exists in the search horizon", () => {
    const taken = Array.from({ length: 30 }, (_, i) => {
      const day = String(17 + i).padStart(2, "0");
      return `2026-08-${day}T09:00:00.000Z`;
    });
    expect(() =>
      nextFreeSlot({
        now: new Date("2026-08-17T06:00:00.000Z"),
        timezone: "UTC", windows: ["09:00"], takenAt: taken, horizonDays: 5,
      }),
    ).toThrow(/no free slot/i);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/content/slot-planner.test.ts`
Expected: FAIL — cannot resolve `./slot-planner`.

- [ ] **Step 4: Implement the planner**

`apps/api/src/content/slot-planner.ts`:

```ts
import { addDays, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export interface SlotOptions {
  now: Date;
  timezone: string;
  windows: string[];
  /** ISO instants already scheduled for this account. */
  takenAt: string[];
  minLeadMinutes?: number;
  collisionMinutes?: number;
  horizonDays?: number;
}

const MINUTE = 60_000;

/**
 * Returns the first posting window at least `minLeadMinutes` in the future
 * with no existing post within `collisionMinutes`. Windows are wall-clock
 * times in the account's timezone, so they stay at 09:00 local across a
 * daylight-saving change.
 */
export function nextFreeSlot(opts: SlotOptions): string {
  const {
    now, timezone, windows, takenAt,
    minLeadMinutes = 30, collisionMinutes = 30, horizonDays = 14,
  } = opts;

  const earliest = now.getTime() + minLeadMinutes * MINUTE;
  const takenMs = takenAt.map((iso) => new Date(iso).getTime());
  const sortedWindows = [...windows].sort();

  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
    const localDay = format(addDays(toZonedTime(now, timezone), dayOffset), "yyyy-MM-dd");

    for (const window of sortedWindows) {
      const instant = fromZonedTime(`${localDay}T${window}:00`, timezone).getTime();
      if (instant < earliest) continue;

      const collides = takenMs.some((t) => Math.abs(t - instant) < collisionMinutes * MINUTE);
      if (collides) continue;

      return new Date(instant).toISOString();
    }
  }

  throw new Error(`no free slot within ${horizonDays} days`);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm vitest run apps/api/src/content/slot-planner.test.ts` then `pnpm typecheck`
Expected: 8 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add timezone-aware slot planner"
```

---

## Task 7: Drafting graph and draft worker

**Files:**
- Create: `apps/api/src/content/drafting.graph.ts`, `apps/api/src/jobs/draft.processor.ts`, `apps/api/src/jobs/workers.service.ts`
- Modify: `apps/api/src/posts/post.repository.ts` (add `listScheduledAfter`), `apps/api/src/jobs/jobs.module.ts`
- Test: `apps/api/src/content/drafting.graph.test.ts`, `apps/api/test/draft-flow.e2e.test.ts`

**Interfaces:**
- Consumes: `COPY_WRITER`, `nextFreeSlot`, `PostRepository`, `MediaAssetRepository`, `AccountRepository`
- Produces:
  - `runDrafting(deps, input): Promise<{ postId: string }>` where
    `input = { accountId: string; assetId: string; format: PostFormat }`
  - `PostRepository.listScheduledAfter(accountId, fromIso): Promise<string[]>` — scheduled instants for `PENDING_APPROVAL` and `APPROVED`
  - `WorkersService` — starts BullMQ workers on module init, closes them on shutdown

- [ ] **Step 1: Install LangGraph**

```bash
pnpm --filter @intabot/api add @langchain/langgraph@0.2.44 @langchain/core@0.3.29
```

- [ ] **Step 2: Write the failing graph test**

`apps/api/src/content/drafting.graph.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { CopyWriterRefusalError } from "./copy-writer.port";
import { FakeCopyWriter } from "./fake-copy-writer";
import { runDrafting } from "./drafting.graph";

function deps(overrides: Partial<Parameters<typeof runDrafting>[0]> = {}) {
  return {
    copyWriter: new FakeCopyWriter(),
    loadAccount: vi.fn(async () => ({
      voice: "warm, plain", timezone: "UTC", postingWindows: ["09:00"],
    })),
    loadRecentCaptions: vi.fn(async () => ["Older caption."]),
    loadTakenSlots: vi.fn(async () => [] as string[]),
    now: () => new Date("2026-08-17T06:00:00.000Z"),
    ...overrides,
  };
}

const input = { accountId: "acct-1", assetId: "asset-1", format: "IMAGE" as const };

describe("runDrafting", () => {
  it("produces a caption, hashtags, alt text and a slot", async () => {
    const result = await runDrafting(deps(), input);
    expect(result.caption.length).toBeGreaterThan(0);
    expect(result.hashtags.length).toBeGreaterThan(0);
    expect(result.altText.length).toBeGreaterThan(0);
    expect(result.scheduledAt).toBe("2026-08-17T09:00:00.000Z");
    expect(result.needsAttention).toBe(false);
  });

  it("passes the account voice and recent captions to the copy writer", async () => {
    const copyWriter = new FakeCopyWriter();
    const spy = vi.spyOn(copyWriter, "draft");
    await runDrafting(deps({ copyWriter }), input);
    expect(spy.mock.calls[0]?.[0].accountVoice).toBe("warm, plain");
    expect(spy.mock.calls[0]?.[0].recentCaptions).toEqual(["Older caption."]);
  });

  it("still returns a slot when the copy writer refuses, flagged for attention", async () => {
    const copyWriter = new FakeCopyWriter();
    copyWriter.setNextRefusal();
    const result = await runDrafting(deps({ copyWriter }), input);
    expect(result.caption).toBe("");
    expect(result.hashtags).toEqual([]);
    expect(result.needsAttention).toBe(true);
    expect(result.scheduledAt).toBe("2026-08-17T09:00:00.000Z");
  });

  it("avoids a slot that is already taken", async () => {
    const result = await runDrafting(
      deps({
        loadAccount: vi.fn(async () => ({
          voice: "v", timezone: "UTC", postingWindows: ["09:00", "12:30"],
        })),
        loadTakenSlots: vi.fn(async () => ["2026-08-17T09:00:00.000Z"]),
      }),
      input,
    );
    expect(result.scheduledAt).toBe("2026-08-17T12:30:00.000Z");
  });

  it("propagates a non-refusal copy writer error", async () => {
    const copyWriter = new FakeCopyWriter();
    vi.spyOn(copyWriter, "draft").mockRejectedValue(new Error("network down"));
    await expect(runDrafting(deps({ copyWriter }), input)).rejects.toThrow("network down");
  });
});
```

Note the deliberate asymmetry in the last two tests: a **refusal** is a normal
outcome that still produces a post, while any **other** error propagates so
BullMQ can retry it.

> **Deviation from the spec, deliberate.** Spec §5 says a structured-output
> validation failure should reach the queue with empty copy after one retry.
> This plan treats it as a retryable error instead: it propagates, BullMQ
> retries three times, and the asset ends as `draftFailed` in the library.
> Reason — a schema mismatch means the adapter and the model disagree, which is
> a bug to surface, not a caption to leave blank. Only an explicit *refusal*,
> which is a normal model outcome, produces an empty-copy post. Say so if you
> want the spec's behaviour instead; it is a two-line change in `draftCopy`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/content/drafting.graph.test.ts`
Expected: FAIL — cannot resolve `./drafting.graph`.

- [ ] **Step 4: Implement the graph**

`apps/api/src/content/drafting.graph.ts`:

```ts
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { PostFormat } from "@intabot/shared";
import { CopyWriterRefusalError, type CopyWriterPort } from "./copy-writer.port";
import { nextFreeSlot } from "./slot-planner";

export interface DraftingDeps {
  copyWriter: CopyWriterPort;
  loadAccount(accountId: string): Promise<{
    voice: string;
    timezone: string;
    postingWindows: string[];
  }>;
  loadRecentCaptions(accountId: string): Promise<string[]>;
  loadTakenSlots(accountId: string, fromIso: string): Promise<string[]>;
  now(): Date;
}

export interface DraftingInput {
  accountId: string;
  assetId: string;
  format: PostFormat;
}

export interface DraftingResult {
  caption: string;
  hashtags: string[];
  altText: string;
  scheduledAt: string;
  needsAttention: boolean;
}

const DraftingState = Annotation.Root({
  accountId: Annotation<string>,
  format: Annotation<PostFormat>,
  voice: Annotation<string>,
  timezone: Annotation<string>,
  postingWindows: Annotation<string[]>,
  recentCaptions: Annotation<string[]>,
  caption: Annotation<string>,
  hashtags: Annotation<string[]>,
  altText: Annotation<string>,
  scheduledAt: Annotation<string>,
  needsAttention: Annotation<boolean>,
});

export async function runDrafting(
  deps: DraftingDeps,
  input: DraftingInput,
): Promise<DraftingResult> {
  const graph = new StateGraph(DraftingState)
    .addNode("loadContext", async (state) => {
      const account = await deps.loadAccount(state.accountId);
      const recentCaptions = await deps.loadRecentCaptions(state.accountId);
      return {
        voice: account.voice,
        timezone: account.timezone,
        postingWindows: account.postingWindows,
        recentCaptions,
      };
    })
    .addNode("draftCopy", async (state) => {
      try {
        const out = await deps.copyWriter.draft({
          accountVoice: state.voice,
          format: state.format,
          recentCaptions: state.recentCaptions,
          mediaMeta: { contentType: "" },
        });
        return { ...out, needsAttention: false };
      } catch (err) {
        // A refusal is an expected outcome: the post still reaches the queue
        // with empty copy for a human to write. Anything else is a real
        // failure and must propagate so the job retries.
        if (err instanceof CopyWriterRefusalError) {
          return { caption: "", hashtags: [], altText: "", needsAttention: true };
        }
        throw err;
      }
    })
    .addNode("planSlot", async (state) => {
      const now = deps.now();
      const takenAt = await deps.loadTakenSlots(state.accountId, now.toISOString());
      return {
        scheduledAt: nextFreeSlot({
          now,
          timezone: state.timezone,
          windows: state.postingWindows,
          takenAt,
        }),
      };
    })
    .addEdge(START, "loadContext")
    .addEdge("loadContext", "draftCopy")
    .addEdge("draftCopy", "planSlot")
    .addEdge("planSlot", END)
    .compile();

  const final = await graph.invoke({
    accountId: input.accountId,
    format: input.format,
  });

  return {
    caption: final.caption,
    hashtags: final.hashtags,
    altText: final.altText,
    scheduledAt: final.scheduledAt,
    needsAttention: final.needsAttention,
  };
}
```

- [ ] **Step 5: Run the graph test**

Run: `pnpm vitest run apps/api/src/content/drafting.graph.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the repository query the planner needs**

Append to `apps/api/src/posts/post.repository.ts`:

```ts
  /**
   * Scheduled instants for posts that still occupy a slot: anything awaiting
   * approval or already approved. Published and failed posts free their slot.
   */
  async listScheduledAfter(accountId: string, fromIso: string): Promise<string[]> {
    const statuses: PostStatus[] = ["PENDING_APPROVAL", "APPROVED"];
    const results: string[] = [];

    for (const status of statuses) {
      const out = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk AND GSI1SK >= :from",
          ExpressionAttributeValues: {
            ":pk": `ACCT#${accountId}#ST#${status}`,
            ":from": fromIso,
          },
        }),
      );
      for (const item of out.Items ?? []) {
        results.push(PostSchema.parse(item).scheduledAt);
      }
    }
    return results;
  }
```

- [ ] **Step 7: Write the failing draft-flow test**

`apps/api/test/draft-flow.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { FakeCopyWriter } from "../src/content/fake-copy-writer";
import { DraftProcessor } from "../src/jobs/draft.processor";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

describe("draft flow", () => {
  let app: INestApplication;
  let accountId: string;
  let assetId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    app.get(FakeCopyWriter).reset();
    const account = await app.get(AccountRepository).create({
      name: "Studio Nord", igUserId: "1784140", username: "studionord",
      accessTokenEncrypted: "v1:a:b:c", tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    const asset = await app.get(MediaAssetRepository).create({
      accountId, storageKey: `${accountId}/a.jpg`, contentType: "image/jpeg", sizeBytes: 1024,
    });
    assetId = asset.id;
  });

  afterAll(async () => { await app.close(); });

  it("turns an asset into a PENDING_APPROVAL post", async () => {
    await app.get(DraftProcessor).process({ accountId, assetId, format: "IMAGE" });

    const queue = await app.get(PostRepository).listByStatus(accountId, "PENDING_APPROVAL");
    expect(queue).toHaveLength(1);
    expect(queue[0]?.caption.length).toBeGreaterThan(0);
    expect(queue[0]?.mediaAssetIds).toEqual([assetId]);
    expect(queue[0]?.version).toBe(2);
  });

  it("flags the post when the copy writer refuses, and still queues it", async () => {
    app.get(FakeCopyWriter).setNextRefusal();
    await app.get(DraftProcessor).process({ accountId, assetId, format: "IMAGE" });

    const queue = await app.get(PostRepository).listByStatus(accountId, "PENDING_APPROVAL");
    expect(queue[0]?.needsAttention).toBe(true);
    expect(queue[0]?.caption).toBe("");
  });

  it("does not schedule two posts into the same slot", async () => {
    const second = await app.get(MediaAssetRepository).create({
      accountId, storageKey: `${accountId}/b.jpg`, contentType: "image/jpeg", sizeBytes: 1024,
    });
    await app.get(DraftProcessor).process({ accountId, assetId, format: "IMAGE" });
    await app.get(DraftProcessor).process({ accountId, assetId: second.id, format: "IMAGE" });

    const queue = await app.get(PostRepository).listByStatus(accountId, "PENDING_APPROVAL");
    const slots = queue.map((p) => p.scheduledAt);
    expect(new Set(slots).size).toBe(2);
  });

  it("marks the asset draftFailed when drafting throws", async () => {
    const writer = app.get(FakeCopyWriter);
    const original = writer.draft.bind(writer);
    writer.draft = async () => { throw new Error("network down"); };
    try {
      await expect(
        app.get(DraftProcessor).process({ accountId, assetId, format: "IMAGE" }),
      ).rejects.toThrow("network down");
    } finally {
      writer.draft = original;
    }
    expect((await app.get(MediaAssetRepository).get(accountId, assetId))?.draftFailed).toBe(true);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/draft-flow.e2e.test.ts`
Expected: FAIL — cannot resolve `../src/jobs/draft.processor`.

- [ ] **Step 9: Implement the processor and worker bootstrap**

`apps/api/src/jobs/draft.processor.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PostFormat } from "@intabot/shared";
import { AccountRepository } from "../accounts/account.repository";
import { COPY_WRITER, type CopyWriterPort } from "../content/copy-writer.port";
import { runDrafting } from "../content/drafting.graph";
import { MediaAssetRepository } from "../media/media-asset.repository";
import { PostRepository } from "../posts/post.repository";

export interface DraftJobData {
  accountId: string;
  assetId: string;
  format: PostFormat;
}

@Injectable()
export class DraftProcessor {
  private readonly logger = new Logger(DraftProcessor.name);

  constructor(
    @Inject(COPY_WRITER) private readonly copyWriter: CopyWriterPort,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(MediaAssetRepository) private readonly assets: MediaAssetRepository,
  ) {}

  async process(data: DraftJobData): Promise<{ postId: string }> {
    const { accountId, assetId, format } = data;

    try {
      const result = await runDrafting(
        {
          copyWriter: this.copyWriter,
          loadAccount: async (id) => {
            const account = await this.accounts.get(id);
            if (!account) throw new Error(`account not found: ${id}`);
            return {
              voice: account.voice ?? "clear, friendly, specific",
              timezone: account.timezone,
              postingWindows: account.postingWindows,
            };
          },
          loadRecentCaptions: async (id) =>
            (await this.posts.listByStatus(id, "PUBLISHED")).slice(-10).map((p) => p.caption),
          loadTakenSlots: async (id, fromIso) => this.posts.listScheduledAfter(id, fromIso),
          now: () => new Date(),
        },
        { accountId, assetId, format },
      );

      const draft = await this.posts.create({
        accountId,
        format,
        mediaAssetIds: [assetId],
        caption: result.caption,
        hashtags: result.hashtags,
        scheduledAt: result.scheduledAt,
      });

      await this.posts.transition({
        accountId,
        postId: draft.id,
        expectedStatus: "DRAFT",
        expectedVersion: draft.version,
        nextStatus: "PENDING_APPROVAL",
        patch: {
          altText: result.altText,
          ...(result.needsAttention ? { needsAttention: true } : {}),
        },
      });

      return { postId: draft.id };
    } catch (err) {
      // The asset must never be silently lost. Mark it and rethrow so BullMQ
      // retries; after the final attempt the operator sees it in the library.
      await this.assets.markDraftFailed(accountId, assetId);
      this.logger.error(`drafting failed for asset ${assetId}`);
      throw err;
    }
  }
}
```

The `patch` above sets `altText` and `needsAttention`, so extend `PostPatch` in
`apps/api/src/posts/post.repository.ts`:

```ts
export type PostPatch = Partial<
  Pick<
    Post,
    | "caption" | "hashtags" | "scheduledAt" | "containerId" | "igMediaId"
    | "permalink" | "failureReason" | "altText" | "needsAttention" | "dryRun"
  >
>;
```

`apps/api/src/jobs/workers.service.ts`:

```ts
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { DraftProcessor, type DraftJobData } from "./draft.processor";
import { QUEUE, REDIS_CONNECTION, queuePrefix } from "./queue.constants";

@Injectable()
export class WorkersService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkersService.name);
  private workers: Worker[] = [];

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    @Inject(DraftProcessor) private readonly draft: DraftProcessor,
  ) {}

  onModuleInit(): void {
    // Tests drive processors directly; starting workers there would race with
    // the per-test table resets.
    if (process.env.NODE_ENV === "test") return;

    this.workers.push(
      new Worker<DraftJobData>(
        QUEUE.draft,
        async (job) => this.draft.process(job.data),
        { connection: this.connection, prefix: queuePrefix() },
      ),
    );
    this.logger.log(`started ${this.workers.length} worker(s)`);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
```

Register `DraftProcessor` and `WorkersService` as providers in `JobsModule`, and
import `ContentModule`, `MediaModule`, `AccountsModule`, and `PostsModule` there.

- [ ] **Step 10: Run tests and typecheck**

Run: `pnpm vitest run apps/api/test/draft-flow.e2e.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat(api): add drafting graph and draft worker"
```

---

## Task 8: Approval queue REST

**Files:**
- Create: `apps/api/src/approvals/approvals.controller.ts`, `approvals.module.ts`
- Test: `apps/api/test/approvals.e2e.test.ts`

**Interfaces:**
- Consumes: `PostRepository`, `AuthGuard`
- Produces:
  - `GET /approvals?accountId=` → pending posts, oldest slot first
  - `POST /approvals/:id/approve` body `{ accountId, expectedVersion, caption?, hashtags?, scheduledAt? }` → approved post, `409` on version mismatch
  - `POST /approvals/:id/reject` body `{ accountId, expectedVersion }` → rejected post

- [ ] **Step 1: Write the failing test**

`apps/api/test/approvals.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

describe("approvals", () => {
  let app: INestApplication;
  let cookie: string;
  let accountId: string;
  let postId: string;
  let version: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await app.get(UserRepository).create("op@example.com", await app.get(PasswordService).hash("pw"));
    const login = await request(app.getHttpServer())
      .post("/auth/login").send({ email: "op@example.com", password: "pw" });
    cookie = login.headers["set-cookie"]!;

    const account = await app.get(AccountRepository).create({
      name: "Studio Nord", igUserId: "1784140", username: "studionord",
      accessTokenEncrypted: "v1:a:b:c", tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;

    const posts = app.get(PostRepository);
    const draft = await posts.create({
      accountId, format: "IMAGE", mediaAssetIds: ["a1"],
      caption: "Draft copy.", hashtags: ["#studio"],
      scheduledAt: "2026-08-20T09:00:00.000Z",
    });
    const pending = await posts.transition({
      accountId, postId: draft.id, expectedStatus: "DRAFT",
      expectedVersion: draft.version, nextStatus: "PENDING_APPROVAL",
    });
    postId = pending.id;
    version = pending.version;
  });

  afterAll(async () => { await app.close(); });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get(`/approvals?accountId=${accountId}`).expect(401);
  });

  it("lists pending posts", async () => {
    const res = await request(app.getHttpServer())
      .get(`/approvals?accountId=${accountId}`).set("Cookie", cookie).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].caption).toBe("Draft copy.");
  });

  it("approves a post", async () => {
    const res = await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`).set("Cookie", cookie)
      .send({ accountId, expectedVersion: version }).expect(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.version).toBe(version + 1);
  });

  it("applies an edited caption on approval", async () => {
    const res = await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`).set("Cookie", cookie)
      .send({ accountId, expectedVersion: version, caption: "Human wrote this." }).expect(200);
    expect(res.body.caption).toBe("Human wrote this.");
  });

  it("returns 409 when the version is stale", async () => {
    await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`).set("Cookie", cookie)
      .send({ accountId, expectedVersion: version }).expect(200);

    await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`).set("Cookie", cookie)
      .send({ accountId, expectedVersion: version }).expect(409);
  });

  it("rejects a post", async () => {
    const res = await request(app.getHttpServer())
      .post(`/approvals/${postId}/reject`).set("Cookie", cookie)
      .send({ accountId, expectedVersion: version }).expect(200);
    expect(res.body.status).toBe("REJECTED");
  });

  it("returns 400 when expectedVersion is missing", async () => {
    await request(app.getHttpServer())
      .post(`/approvals/${postId}/approve`).set("Cookie", cookie)
      .send({ accountId }).expect(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/approvals.e2e.test.ts`
Expected: FAIL — 404 on `/approvals`.

- [ ] **Step 3: Implement the controller and module**

`apps/api/src/approvals/approvals.controller.ts`:

```ts
import {
  BadRequestException, Body, ConflictException, Controller, Get,
  HttpCode, Inject, Param, Post, Query, UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { PostRepository, PostTransitionConflictError } from "../posts/post.repository";

const DecisionBody = z.object({
  accountId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
});

@Controller("approvals")
@UseGuards(AuthGuard)
export class ApprovalsController {
  constructor(@Inject(PostRepository) private readonly posts: PostRepository) {}

  @Get()
  async list(@Query("accountId") accountId?: string) {
    if (!accountId) throw new BadRequestException("accountId is required");
    return this.posts.listByStatus(accountId, "PENDING_APPROVAL");
  }

  @Post(":id/approve")
  @HttpCode(200)
  async approve(@Param("id") id: string, @Body() body: unknown) {
    const parsed = DecisionBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const { accountId, expectedVersion, caption, hashtags, scheduledAt } = parsed.data;
    try {
      return await this.posts.transition({
        accountId,
        postId: id,
        expectedStatus: "PENDING_APPROVAL",
        expectedVersion,
        nextStatus: "APPROVED",
        patch: {
          ...(caption !== undefined ? { caption } : {}),
          ...(hashtags !== undefined ? { hashtags } : {}),
          ...(scheduledAt !== undefined ? { scheduledAt } : {}),
        },
      });
    } catch (err) {
      if (err instanceof PostTransitionConflictError) throw new ConflictException(err.message);
      throw err;
    }
  }

  @Post(":id/reject")
  @HttpCode(200)
  async reject(@Param("id") id: string, @Body() body: unknown) {
    const parsed = DecisionBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    try {
      return await this.posts.transition({
        accountId: parsed.data.accountId,
        postId: id,
        expectedStatus: "PENDING_APPROVAL",
        expectedVersion: parsed.data.expectedVersion,
        nextStatus: "REJECTED",
      });
    } catch (err) {
      if (err instanceof PostTransitionConflictError) throw new ConflictException(err.message);
      throw err;
    }
  }
}
```

`apps/api/src/approvals/approvals.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PostsModule } from "../posts/posts.module";
import { ApprovalsController } from "./approvals.controller";

@Module({ imports: [PostsModule], controllers: [ApprovalsController] })
export class ApprovalsModule {}
```

Add `ApprovalsModule` to `AppModule`'s `imports`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run apps/api/test/approvals.e2e.test.ts` then `pnpm typecheck`
Expected: 7 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add approval queue endpoints with version-guarded decisions"
```

---

## Task 9: Publish scan and publish job

**Files:**
- Create: `apps/api/src/jobs/publish-scan.processor.ts`, `apps/api/src/jobs/publish.processor.ts`
- Modify: `apps/api/src/posts/post.repository.ts` (add `listDue`), `apps/api/src/jobs/workers.service.ts`
- Test: `apps/api/test/publish-flow.e2e.test.ts`

**Interfaces:**
- Consumes: `PostRepository`, `AccountRepository`, `INSTAGRAM_PORT`, `MEDIA_STORAGE`, `MediaAssetRepository`, `PUBLISH_QUEUE`, `POLL_QUEUE`
- Produces:
  - `PostRepository.listDue(accountId, beforeIso): Promise<Post[]>` — `APPROVED` with `scheduledAt <= beforeIso`
  - `PublishScanProcessor.process(): Promise<{ enqueued: number }>`
  - `PublishProcessor.process(data: { accountId, postId }): Promise<{ containerId: string | null }>`

- [ ] **Step 1: Add the due-post query**

Append to `apps/api/src/posts/post.repository.ts`:

```ts
  /** APPROVED posts whose slot has arrived. */
  async listDue(accountId: string, beforeIso: string): Promise<Post[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk AND GSI1SK <= :before",
        ExpressionAttributeValues: {
          ":pk": `ACCT#${accountId}#ST#APPROVED`,
          ":before": beforeIso,
        },
        ScanIndexForward: true,
      }),
    );
    return (out.Items ?? []).map((item) => PostSchema.parse(item));
  }
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/publish-flow.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { PublishProcessor } from "../src/jobs/publish.processor";
import { PublishScanProcessor } from "../src/jobs/publish-scan.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues, testQueue } from "./queue-fixture";

describe("publish flow", () => {
  let app: INestApplication;
  let accountId: string;
  let postId: string;

  async function approvedPost(scheduledAt: string) {
    const posts = app.get(PostRepository);
    const asset = await app.get(MediaAssetRepository).create({
      accountId, storageKey: `${accountId}/a.jpg`, contentType: "image/jpeg", sizeBytes: 10,
    });
    const draft = await posts.create({
      accountId, format: "IMAGE", mediaAssetIds: [asset.id],
      caption: "Copy.", hashtags: [], scheduledAt,
    });
    const pending = await posts.transition({
      accountId, postId: draft.id, expectedStatus: "DRAFT",
      expectedVersion: draft.version, nextStatus: "PENDING_APPROVAL",
    });
    await posts.transition({
      accountId, postId: draft.id, expectedStatus: "PENDING_APPROVAL",
      expectedVersion: pending.version, nextStatus: "APPROVED",
    });
    return draft.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.publish, QUEUE.pollContainer]);
    app.get(FakeInstagramAdapter).reset();
    const account = await app.get(AccountRepository).create({
      name: "Studio Nord", igUserId: "1784140", username: "studionord",
      accessTokenEncrypted: "v1:a:b:c", tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    postId = await approvedPost("2020-01-01T00:00:00.000Z"); // long overdue
  });

  afterAll(async () => { await app.close(); });

  it("enqueues a due post exactly once", async () => {
    const result = await app.get(PublishScanProcessor).process();
    expect(result.enqueued).toBe(1);

    const q = testQueue(QUEUE.publish);
    expect(await q.getWaitingCount()).toBe(1);
    await q.close();
  });

  it("does not enqueue a post whose slot is in the future", async () => {
    await resetTables();
    const account = await app.get(AccountRepository).create({
      name: "B", igUserId: "2", username: "b",
      accessTokenEncrypted: "v1:a:b:c", tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    await approvedPost("2099-01-01T00:00:00.000Z");
    expect((await app.get(PublishScanProcessor).process()).enqueued).toBe(0);
  });

  it("claims the post before creating a container", async () => {
    await app.get(PublishProcessor).process({ accountId, postId });
    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("PUBLISHING");
    expect(post?.containerId).toBeTruthy();
    expect(app.get(FakeInstagramAdapter).getContainerCount()).toBe(1);
  });

  it("creates only one container when the publish job runs twice", async () => {
    await app.get(PublishProcessor).process({ accountId, postId });
    await app.get(PublishProcessor).process({ accountId, postId });
    expect(app.get(FakeInstagramAdapter).getContainerCount()).toBe(1);
  });

  it("creates no container at all in dry-run mode", async () => {
    await app.get(AccountRepository).update(accountId, { dryRun: true });
    await app.get(PublishProcessor).process({ accountId, postId });

    expect(app.get(FakeInstagramAdapter).getContainerCount()).toBe(0);
    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("PUBLISHED");
    expect(post?.dryRun).toBe(true);
    expect(post?.igMediaId).toMatch(/^dryrun-/);
  });
});
```

- [ ] **Step 3: Add the container counter to the fake**

The test needs to count containers. Append to
`apps/api/src/instagram/fake-instagram.adapter.ts`:

```ts
  getContainerCount(): number {
    return this.containers.size;
  }
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run apps/api/test/publish-flow.e2e.test.ts`
Expected: FAIL — cannot resolve `../src/jobs/publish.processor`.

- [ ] **Step 5: Implement the scan processor**

`apps/api/src/jobs/publish-scan.processor.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { AccountRepository } from "../accounts/account.repository";
import { PostRepository } from "../posts/post.repository";
import { PUBLISH_QUEUE } from "./queue.constants";

@Injectable()
export class PublishScanProcessor {
  private readonly logger = new Logger(PublishScanProcessor.name);

  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(PUBLISH_QUEUE) private readonly publishQueue: Queue,
  ) {}

  async process(): Promise<{ enqueued: number }> {
    const now = new Date().toISOString();
    let enqueued = 0;

    for (const account of await this.accounts.list()) {
      if (account.status !== "ACTIVE") continue;

      for (const post of await this.posts.listDue(account.id, now)) {
        await this.publishQueue.add(
          "publish",
          { accountId: account.id, postId: post.id },
          // The version in the jobId means a re-approved post can be
          // published again, while a duplicated scan cannot double-enqueue.
          { jobId: `publish:${post.id}:${post.version}`, attempts: 3 },
        );
        enqueued += 1;
      }
    }

    if (enqueued > 0) this.logger.log(`enqueued ${enqueued} post(s) for publishing`);
    return { enqueued };
  }
}
```

- [ ] **Step 6: Implement the publish processor**

`apps/api/src/jobs/publish.processor.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { ulid } from "ulid";
import { AccountRepository } from "../accounts/account.repository";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import { MediaAssetRepository } from "../media/media-asset.repository";
import { MEDIA_STORAGE, type MediaStoragePort } from "../media/media-storage.port";
import { PostRepository, PostTransitionConflictError } from "../posts/post.repository";
import { POLL_QUEUE } from "./queue.constants";

export interface PublishJobData {
  accountId: string;
  postId: string;
}

const MEDIA_URL_TTL_SECONDS = 3600;

@Injectable()
export class PublishProcessor {
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(MediaAssetRepository) private readonly assets: MediaAssetRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(INSTAGRAM_PORT) private readonly instagram: InstagramPort,
    @Inject(POLL_QUEUE) private readonly pollQueue: Queue,
  ) {}

  async process(data: PublishJobData): Promise<{ containerId: string | null }> {
    const { accountId, postId } = data;

    const account = await this.accounts.get(accountId);
    if (!account) throw new Error(`account not found: ${accountId}`);

    const post = await this.posts.get(accountId, postId);
    if (!post) throw new Error(`post not found: ${postId}`);
    if (post.status !== "APPROVED") {
      this.logger.log(`post ${postId} is ${post.status}, not APPROVED - skipping`);
      return { containerId: null };
    }

    // Claim the post BEFORE any external side effect. A duplicated job, a
    // retry, or a racing worker fails this conditional write and no-ops,
    // so at most one Instagram container is ever created.
    let claimed;
    try {
      claimed = await this.posts.transition({
        accountId,
        postId,
        expectedStatus: "APPROVED",
        expectedVersion: post.version,
        nextStatus: "PUBLISHING",
      });
    } catch (err) {
      if (err instanceof PostTransitionConflictError) {
        this.logger.log(`post ${postId} already claimed - skipping`);
        return { containerId: null };
      }
      throw err;
    }

    if (account.dryRun) {
      await this.posts.transition({
        accountId,
        postId,
        expectedStatus: "PUBLISHING",
        expectedVersion: claimed.version,
        nextStatus: "PUBLISHED",
        patch: { igMediaId: `dryrun-${ulid()}`, dryRun: true },
      });
      this.logger.log(`dry run: post ${postId} was not sent to Instagram`);
      return { containerId: null };
    }

    const assetId = post.mediaAssetIds[0];
    if (!assetId) throw new Error(`post ${postId} has no media asset`);
    const asset = await this.assets.get(accountId, assetId);
    if (!asset) throw new Error(`media asset not found: ${assetId}`);

    const mediaUrl = await this.storage.presignedUrl(asset.storageKey, MEDIA_URL_TTL_SECONDS);
    const { containerId } = await this.instagram.createContainer(account, {
      format: post.format,
      mediaUrl,
      caption: [post.caption, post.hashtags.join(" ")].filter(Boolean).join("\n\n"),
    });

    await this.posts.transition({
      accountId,
      postId,
      expectedStatus: "PUBLISHING",
      expectedVersion: claimed.version,
      nextStatus: "PUBLISHING",
      patch: { containerId },
    });

    await this.pollQueue.add(
      "poll",
      { accountId, postId, attempt: 1 },
      { jobId: `poll:${postId}:${containerId}`, delay: 15_000 },
    );

    return { containerId };
  }
}
```

> **Note on the second transition:** `PUBLISHING → PUBLISHING` is intentional.
> It stores `containerId` while still bumping the version, so a stale worker
> holding the earlier version cannot later act on this post.

- [ ] **Step 7: Register the processors**

Add `PublishScanProcessor` and `PublishProcessor` to `JobsModule`'s providers,
and import `InstagramModule` and `MediaModule` there.

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm vitest run apps/api/test/publish-flow.e2e.test.ts`
Expected: PASS, 5 tests. The duplicate-publish and dry-run cases are the ones
that matter.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): add publish scan and claim-before-publish job"
```

---

## Task 10: Container polling

**Files:**
- Create: `apps/api/src/jobs/poll-container.processor.ts`
- Modify: `apps/api/src/jobs/workers.service.ts`, `apps/api/src/jobs/jobs.module.ts`
- Test: `apps/api/test/poll-flow.e2e.test.ts`

**Interfaces:**
- Consumes: `PostRepository`, `AccountRepository`, `INSTAGRAM_PORT`, `POLL_QUEUE`
- Produces: `PollContainerProcessor.process(data: { accountId, postId, attempt }): Promise<PollOutcome>` where
  `PollOutcome = "published" | "failed" | "pending"`; `MAX_POLL_ATTEMPTS = 20`

- [ ] **Step 1: Write the failing test**

`apps/api/test/poll-flow.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { MAX_POLL_ATTEMPTS, PollContainerProcessor } from "../src/jobs/poll-container.processor";
import { PublishProcessor } from "../src/jobs/publish.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues } from "./queue-fixture";

describe("poll flow", () => {
  let app: INestApplication;
  let accountId: string;
  let postId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.publish, QUEUE.pollContainer]);
    app.get(FakeInstagramAdapter).reset();

    const account = await app.get(AccountRepository).create({
      name: "Studio Nord", igUserId: "1784140", username: "studionord",
      accessTokenEncrypted: "v1:a:b:c", tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    accountId = account.id;
    await app.get(AccountRepository).update(accountId, { dryRun: false });

    const posts = app.get(PostRepository);
    const asset = await app.get(MediaAssetRepository).create({
      accountId, storageKey: `${accountId}/a.jpg`, contentType: "image/jpeg", sizeBytes: 10,
    });
    const draft = await posts.create({
      accountId, format: "IMAGE", mediaAssetIds: [asset.id],
      caption: "Copy.", hashtags: ["#studio"], scheduledAt: "2020-01-01T00:00:00.000Z",
    });
    const pending = await posts.transition({
      accountId, postId: draft.id, expectedStatus: "DRAFT",
      expectedVersion: draft.version, nextStatus: "PENDING_APPROVAL",
    });
    await posts.transition({
      accountId, postId: draft.id, expectedStatus: "PENDING_APPROVAL",
      expectedVersion: pending.version, nextStatus: "APPROVED",
    });
    postId = draft.id;
  });

  afterAll(async () => { await app.close(); });

  it("reports pending while the container is still processing", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(3);
    await app.get(PublishProcessor).process({ accountId, postId });

    const outcome = await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });
    expect(outcome).toBe("pending");
    expect((await app.get(PostRepository).get(accountId, postId))?.status).toBe("PUBLISHING");
  });

  it("publishes once the container finishes", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(0);
    await app.get(PublishProcessor).process({ accountId, postId });

    const outcome = await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });
    expect(outcome).toBe("published");

    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("PUBLISHED");
    expect(post?.permalink).toContain("instagram.test");
    expect(post?.igMediaId).toBeTruthy();
  });

  it("fails the post when the container errors", async () => {
    app.get(FakeInstagramAdapter).failNextContainer("MEDIA_TOO_LARGE");
    await app.get(PublishProcessor).process({ accountId, postId });

    const outcome = await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });
    expect(outcome).toBe("failed");

    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("FAILED");
    expect(post?.failureReason).toBeTruthy();
  });

  it("fails the post after the final attempt", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(1000);
    await app.get(PublishProcessor).process({ accountId, postId });

    const outcome = await app
      .get(PollContainerProcessor)
      .process({ accountId, postId, attempt: MAX_POLL_ATTEMPTS });
    expect(outcome).toBe("failed");

    const post = await app.get(PostRepository).get(accountId, postId);
    expect(post?.status).toBe("FAILED");
    expect(post?.failureReason).toMatch(/timeout/i);
  });

  it("publishes exactly one Instagram media even when polled twice", async () => {
    app.get(FakeInstagramAdapter).setProcessingPolls(0);
    await app.get(PublishProcessor).process({ accountId, postId });

    await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 1 });
    await app.get(PollContainerProcessor).process({ accountId, postId, attempt: 2 });

    expect(app.get(FakeInstagramAdapter).getPublished()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/api/test/poll-flow.e2e.test.ts`
Expected: FAIL — cannot resolve `../src/jobs/poll-container.processor`.

- [ ] **Step 3: Implement the processor**

`apps/api/src/jobs/poll-container.processor.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { AccountRepository } from "../accounts/account.repository";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";
import { PostRepository } from "../posts/post.repository";
import { POLL_QUEUE } from "./queue.constants";

export const MAX_POLL_ATTEMPTS = 20;
export const POLL_DELAY_MS = 15_000;

export type PollOutcome = "published" | "failed" | "pending";

export interface PollJobData {
  accountId: string;
  postId: string;
  attempt: number;
}

@Injectable()
export class PollContainerProcessor {
  private readonly logger = new Logger(PollContainerProcessor.name);

  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(INSTAGRAM_PORT) private readonly instagram: InstagramPort,
    @Inject(POLL_QUEUE) private readonly pollQueue: Queue,
  ) {}

  async process(data: PollJobData): Promise<PollOutcome> {
    const { accountId, postId, attempt } = data;

    const account = await this.accounts.get(accountId);
    if (!account) throw new Error(`account not found: ${accountId}`);

    const post = await this.posts.get(accountId, postId);
    if (!post) throw new Error(`post not found: ${postId}`);

    // Another poll already finished this post.
    if (post.status !== "PUBLISHING") return post.status === "PUBLISHED" ? "published" : "failed";
    if (!post.containerId) throw new Error(`post ${postId} has no container`);

    const status = await this.instagram.getContainerStatus(account, post.containerId);

    if (status === "ERROR") {
      await this.posts.transition({
        accountId, postId,
        expectedStatus: "PUBLISHING", expectedVersion: post.version,
        nextStatus: "FAILED",
        patch: { failureReason: "instagram rejected the media container" },
      });
      return "failed";
    }

    if (status === "IN_PROGRESS") {
      if (attempt >= MAX_POLL_ATTEMPTS) {
        await this.posts.transition({
          accountId, postId,
          expectedStatus: "PUBLISHING", expectedVersion: post.version,
          nextStatus: "FAILED",
          patch: { failureReason: "container timeout" },
        });
        return "failed";
      }

      await this.pollQueue.add(
        "poll",
        { accountId, postId, attempt: attempt + 1 },
        { jobId: `poll:${postId}:${post.containerId}:${attempt + 1}`, delay: POLL_DELAY_MS },
      );
      return "pending";
    }

    const result = await this.instagram.publishContainer(account, post.containerId);
    await this.posts.transition({
      accountId, postId,
      expectedStatus: "PUBLISHING", expectedVersion: post.version,
      nextStatus: "PUBLISHED",
      patch: { igMediaId: result.igMediaId, permalink: result.permalink },
    });
    this.logger.log(`published post ${postId} as ${result.igMediaId}`);
    return "published";
  }
}
```

- [ ] **Step 4: Register the processor and start all workers**

Add `PollContainerProcessor` to `JobsModule`'s providers, then extend
`WorkersService.onModuleInit` to start the remaining three workers and the
repeatable scan:

```ts
    this.workers.push(
      new Worker<PublishJobData>(
        QUEUE.publish,
        async (job) => { await this.publish.process(job.data); },
        { connection: this.connection, prefix: queuePrefix() },
      ),
      new Worker<PollJobData>(
        QUEUE.pollContainer,
        async (job) => { await this.poll.process(job.data); },
        { connection: this.connection, prefix: queuePrefix() },
      ),
      new Worker(
        QUEUE.publishScan,
        async () => { await this.scan.process(); },
        { connection: this.connection, prefix: queuePrefix() },
      ),
    );

    // One repeatable trigger drives the scan; BullMQ keeps a single schedule
    // per repeat key even across restarts.
    await this.scanQueue.add("scan", {}, { repeat: { every: 60_000 }, jobId: "publish-scan" });
```

Inject `PublishProcessor`, `PollContainerProcessor`, `PublishScanProcessor`, and
`PUBLISH_SCAN_QUEUE` into `WorkersService`, and change `onModuleInit` to
`async onModuleInit(): Promise<void>`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm vitest run apps/api/test/poll-flow.e2e.test.ts` then `pnpm typecheck`
Expected: 5 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add container polling with timeout and idempotent publish"
```

---

## Task 11: Real Anthropic copy writer

**Files:**
- Create: `apps/api/src/content/anthropic-copy-writer.ts`
- Modify: `apps/api/src/content/content.module.ts`, `apps/api/src/config/env.schema.ts`
- Test: `apps/api/src/content/anthropic-copy-writer.test.ts`

**Interfaces:**
- Consumes: `CopyWriterPort`, `AppConfigService`
- Produces: `AnthropicCopyWriter` implementing `CopyWriterPort`; `buildDraftPrompt(input): string`; config gains `anthropicApiKey?: string`

The adapter's network behaviour is deliberately not tested — the tests cover
prompt construction and response handling with a stubbed client.

- [ ] **Step 1: Install the SDK**

```bash
pnpm --filter @intabot/api add @anthropic-ai/sdk@0.65.0
```

- [ ] **Step 2: Add the optional config key**

In `apps/api/src/config/env.schema.ts`, add to `EnvSchema`:

```ts
  ANTHROPIC_API_KEY: optionalString(z.string().min(1)),
```

add to the `AppConfig` interface:

```ts
  anthropicApiKey?: string;
```

and to the returned object:

```ts
    anthropicApiKey: e.ANTHROPIC_API_KEY,
```

Add a getter to `AppConfigService`:

```ts
  get anthropicApiKey() { return this.config.anthropicApiKey; }
```

Append `ANTHROPIC_API_KEY=` to `.env.example` under a comment noting it is
required only for real caption generation.

- [ ] **Step 3: Write the failing test**

`apps/api/src/content/anthropic-copy-writer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { CopyWriterRefusalError } from "./copy-writer.port";
import { AnthropicCopyWriter, buildDraftPrompt } from "./anthropic-copy-writer";

const input = {
  accountVoice: "warm, plain",
  format: "REEL" as const,
  recentCaptions: ["Yesterday's light."],
  mediaMeta: { contentType: "video/mp4", durationSeconds: 12 },
};

describe("buildDraftPrompt", () => {
  it("includes the voice, the format and the recent captions", () => {
    const prompt = buildDraftPrompt(input);
    expect(prompt).toContain("warm, plain");
    expect(prompt).toContain("REEL");
    expect(prompt).toContain("Yesterday's light.");
  });

  it("tells the model not to repeat recent captions", () => {
    expect(buildDraftPrompt(input).toLowerCase()).toContain("do not repeat");
  });
});

describe("AnthropicCopyWriter", () => {
  function writerWith(create: ReturnType<typeof vi.fn>) {
    return new AnthropicCopyWriter({ messages: { create } } as never, "claude-opus-5");
  }

  it("returns the parsed structured output", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            caption: "Light through the window.",
            hashtags: ["#studio"],
            altText: "Sunlight across a workbench.",
          }),
        },
      ],
    });
    const out = await writerWith(create).draft(input);
    expect(out.caption).toBe("Light through the window.");
    expect(out.hashtags).toEqual(["#studio"]);
  });

  it("requests claude-opus-5 with a json schema output format", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ caption: "a", hashtags: [], altText: "b" }) }],
    });
    await writerWith(create).draft(input);
    const params = create.mock.calls[0]?.[0];
    expect(params.model).toBe("claude-opus-5");
    expect(params.output_config.format.type).toBe("json_schema");
  });

  it("throws CopyWriterRefusalError on a refusal stop reason", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { category: "other" },
      content: [],
    });
    await expect(writerWith(create).draft(input)).rejects.toBeInstanceOf(CopyWriterRefusalError);
  });

  it("throws when the response contains no text block", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [] });
    await expect(writerWith(create).draft(input)).rejects.toThrow(/no text/i);
  });

  it("throws when the payload does not match the schema", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ caption: 42 }) }],
    });
    await expect(writerWith(create).draft(input)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm vitest run apps/api/src/content/anthropic-copy-writer.test.ts`
Expected: FAIL — cannot resolve `./anthropic-copy-writer`.

- [ ] **Step 5: Implement the adapter**

`apps/api/src/content/anthropic-copy-writer.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppConfigService } from "../config/config.service";
import {
  CopyWriterRefusalError,
  type CopyWriterPort,
  type DraftInput,
  type DraftOutput,
} from "./copy-writer.port";

export const DEFAULT_MODEL = "claude-opus-5";

const DraftPayload = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
  altText: z.string().min(1),
});

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    altText: { type: "string" },
  },
  required: ["caption", "hashtags", "altText"],
  additionalProperties: false,
} as const;

export function buildDraftPrompt(input: DraftInput): string {
  const recent = input.recentCaptions.length
    ? input.recentCaptions.map((c) => `- ${c}`).join("\n")
    : "- (none yet)";

  return [
    `Write an Instagram caption for a ${input.format}.`,
    ``,
    `Brand voice: ${input.accountVoice}`,
    `Media type: ${input.mediaMeta.contentType}`,
    ``,
    `Recent captions from this account. Do not repeat their phrasing, structure, or opening:`,
    recent,
    ``,
    `Return a caption, a short list of relevant hashtags, and alt text describing`,
    `the image for a screen reader. Keep the caption under 300 characters.`,
  ].join("\n");
}

@Injectable()
export class AnthropicCopyWriter implements CopyWriterPort {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    @Inject(AppConfigService) clientOrConfig: AppConfigService | Anthropic,
    model: string = DEFAULT_MODEL,
  ) {
    if (clientOrConfig instanceof AppConfigService) {
      const apiKey = clientOrConfig.anthropicApiKey;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for AnthropicCopyWriter");
      this.client = new Anthropic({ apiKey });
    } else {
      this.client = clientOrConfig as Anthropic;
    }
    this.model = model;
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: buildDraftPrompt(input) }],
    } as never);

    const message = response as unknown as {
      stop_reason: string;
      stop_details?: { category?: string | null };
      content: Array<{ type: string; text?: string }>;
    };

    // Check stop_reason before reading content: a refusal returns HTTP 200
    // with an empty content array.
    if (message.stop_reason === "refusal") {
      throw new CopyWriterRefusalError(message.stop_details?.category ?? "unspecified");
    }

    const text = message.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("copy writer response contained no text block");

    return DraftPayload.parse(JSON.parse(text));
  }
}
```

- [ ] **Step 6: Select the adapter by configuration**

Replace the providers in `apps/api/src/content/content.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { AnthropicCopyWriter } from "./anthropic-copy-writer";
import { COPY_WRITER } from "./copy-writer.port";
import { FakeCopyWriter } from "./fake-copy-writer";

@Module({
  providers: [
    FakeCopyWriter,
    {
      provide: COPY_WRITER,
      inject: [AppConfigService, FakeCopyWriter],
      // The fake is the default. A real key opts in to real generation, so
      // tests and a fresh checkout never need credentials.
      useFactory: (config: AppConfigService, fake: FakeCopyWriter) =>
        config.anthropicApiKey ? new AnthropicCopyWriter(config) : fake,
    },
  ],
  exports: [COPY_WRITER, FakeCopyWriter],
})
export class ContentModule {}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm vitest run apps/api/src/content` then `pnpm typecheck`
Expected: all content tests pass; typecheck clean.

Note: tests must still pass with `ANTHROPIC_API_KEY` unset, which
`test/setup-env.ts` guarantees by never setting it.

- [ ] **Step 8: Commit**

```bash
git add apps/api .env.example
git commit -m "feat(api): add Anthropic copy writer behind configuration"
```

---

## Task 12: Dashboard upload and approvals

**Files:**
- Create: `apps/web/app/(dashboard)/upload/page.tsx`, `apps/web/app/(dashboard)/upload/upload-form.tsx`
- Create: `apps/web/app/(dashboard)/approvals/page.tsx`, `apps/web/app/(dashboard)/approvals/approval-card.tsx`
- Create: `apps/web/app/(dashboard)/approvals/actions.ts`
- Create: `apps/web/lib/format.ts`, `apps/web/app/api/upload/route.ts`
- Modify: `apps/web/lib/api.ts`, `apps/web/app/(dashboard)/layout.tsx`
- Test: `apps/web/lib/format.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, `AccountView`
- Produces: `PostView` type; `getApprovals(accountId)`; server actions `approvePost`, `rejectPost`

- [ ] **Step 1: Write the failing formatter test**

`apps/web/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatSlot, summarise } from "./format";

describe("formatSlot", () => {
  it("renders an ISO instant as a readable local time", () => {
    expect(formatSlot("2026-08-20T09:00:00.000Z", "UTC")).toBe("20 Aug 2026, 09:00");
  });
});

describe("summarise", () => {
  it("truncates a long caption on a word boundary", () => {
    const long = "a".repeat(20) + " " + "b".repeat(200);
    expect(summarise(long, 30).length).toBeLessThanOrEqual(31);
    expect(summarise(long, 30).endsWith("…")).toBe(true);
  });

  it("leaves a short caption alone", () => {
    expect(summarise("Short.", 30)).toBe("Short.");
  });

  it("renders empty copy as a placeholder", () => {
    expect(summarise("", 30)).toBe("(no caption yet)");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 3: Implement the formatters**

`apps/web/lib/format.ts`:

```ts
export function formatSlot(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: timezone,
  })
    .format(new Date(iso))
    .replace(",", ",");
}

export function summarise(caption: string, max: number): string {
  if (caption.length === 0) return "(no caption yet)";
  if (caption.length <= max) return caption;
  const cut = caption.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > 0 ? boundary : max)}…`;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run apps/web`
Expected: PASS, 4 tests.

- [ ] **Step 5: Extend the API client**

Append to `apps/web/lib/api.ts`:

```ts
export interface PostView {
  id: string;
  accountId: string;
  status: string;
  format: string;
  version: number;
  caption: string;
  hashtags: string[];
  altText?: string;
  needsAttention?: boolean;
  dryRun?: boolean;
  scheduledAt: string;
  permalink?: string;
}

export async function getApprovals(accountId: string): Promise<PostView[]> {
  return apiFetch<PostView[]>(`/approvals?accountId=${encodeURIComponent(accountId)}`);
}
```

- [ ] **Step 6: Add the server actions**

`apps/web/app/(dashboard)/approvals/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/api";

export async function approvePost(formData: FormData): Promise<void> {
  const body = {
    accountId: String(formData.get("accountId")),
    expectedVersion: Number(formData.get("expectedVersion")),
    caption: String(formData.get("caption")),
    hashtags: String(formData.get("hashtags")).split(/\s+/).filter(Boolean),
  };
  await apiFetch(`/approvals/${String(formData.get("postId"))}/approve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  revalidatePath("/approvals");
}

export async function rejectPost(formData: FormData): Promise<void> {
  await apiFetch(`/approvals/${String(formData.get("postId"))}/reject`, {
    method: "POST",
    body: JSON.stringify({
      accountId: String(formData.get("accountId")),
      expectedVersion: Number(formData.get("expectedVersion")),
    }),
  });
  revalidatePath("/approvals");
}
```

- [ ] **Step 7: Build the approvals screen**

`apps/web/app/(dashboard)/approvals/approval-card.tsx`:

```tsx
import type { PostView } from "@/lib/api";
import { formatSlot } from "@/lib/format";
import { approvePost, rejectPost } from "./actions";

export function ApprovalCard({ post, timezone }: { post: PostView; timezone: string }) {
  return (
    <article style={{ border: "1px solid #8883", padding: "1rem", marginBottom: "1rem" }}>
      <p>
        <strong>{post.format}</strong> — {formatSlot(post.scheduledAt, timezone)}
        {post.needsAttention ? <em> · needs a caption</em> : null}
      </p>

      <form action={approvePost}>
        <input type="hidden" name="postId" value={post.id} />
        <input type="hidden" name="accountId" value={post.accountId} />
        <input type="hidden" name="expectedVersion" value={post.version} />
        <label>
          Caption
          <textarea name="caption" defaultValue={post.caption} rows={4} />
        </label>
        <label>
          Hashtags
          <input name="hashtags" defaultValue={post.hashtags.join(" ")} />
        </label>
        <button type="submit">Approve</button>
      </form>

      <form action={rejectPost}>
        <input type="hidden" name="postId" value={post.id} />
        <input type="hidden" name="accountId" value={post.accountId} />
        <input type="hidden" name="expectedVersion" value={post.version} />
        <button type="submit">Reject</button>
      </form>
    </article>
  );
}
```

`apps/web/app/(dashboard)/approvals/page.tsx`:

```tsx
import { getAccounts, getApprovals } from "@/lib/api";
import { ApprovalCard } from "./approval-card";

export default async function ApprovalsPage() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return <p>Connect an account first.</p>;

  const sections = await Promise.all(
    accounts.map(async (account) => ({
      account,
      posts: await getApprovals(account.id),
    })),
  );

  const total = sections.reduce((n, s) => n + s.posts.length, 0);
  if (total === 0) return <p>Nothing waiting for approval.</p>;

  return (
    <>
      {sections.map(({ account, posts }) =>
        posts.length === 0 ? null : (
          <section key={account.id}>
            <h2>@{account.username}</h2>
            {posts.map((post) => (
              <ApprovalCard key={post.id} post={post} timezone="UTC" />
            ))}
          </section>
        ),
      )}
    </>
  );
}
```

- [ ] **Step 8: Build the upload screen**

`apps/web/app/(dashboard)/upload/upload-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { AccountView } from "@/lib/api";

export function UploadForm({ accounts }: { accounts: AccountView[] }) {
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Uploading…");
    const res = await fetch("/api/upload", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    setStatus(res.ok ? "Uploaded. Drafting has started." : "Upload failed.");
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        Account
        <select name="accountId">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>@{a.username}</option>
          ))}
        </select>
      </label>
      <label>
        File
        <input type="file" name="file" accept="image/jpeg,image/png,image/webp,video/mp4" required />
      </label>
      <button type="submit">Upload</button>
      {status ? <p>{status}</p> : null}
    </form>
  );
}
```

`apps/web/app/(dashboard)/upload/page.tsx`:

```tsx
import { getAccounts } from "@/lib/api";
import { UploadForm } from "./upload-form";

export default async function UploadPage() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return <p>Connect an account first.</p>;
  return <UploadForm accounts={accounts} />;
}
```

`apps/web/app/api/upload/route.ts` — a proxy so the browser never talks to the
API origin directly and the session cookie is forwarded server-side:

```ts
import { cookies } from "next/headers";
import { API_BASE_URL, buildUrl } from "@/lib/http";

export async function POST(request: Request): Promise<Response> {
  const body = await request.formData();
  const res = await fetch(buildUrl(API_BASE_URL, "/media"), {
    method: "POST",
    headers: { cookie: (await cookies()).toString() },
    body,
  });
  return new Response(await res.text(), { status: res.status });
}
```

- [ ] **Step 9: Make the approvals page refresh itself**

Spec §7 calls for a five-second poll while drafting runs. Add to
`apps/web/app/(dashboard)/approvals/page.tsx`, above the component:

```tsx
// Drafting completes asynchronously, so the queue is re-fetched on an
// interval rather than requiring a manual reload. SSE replaces this in
// Phase 5.
export const revalidate = 5;
```

and add the same line to `apps/web/app/(dashboard)/upload/page.tsx`.

- [ ] **Step 10: Add navigation**

In `apps/web/app/(dashboard)/layout.tsx`, add inside `<header>` after the
signed-in line:

```tsx
      <nav>
        <a href="/">Accounts</a> · <a href="/upload">Upload</a> ·{" "}
        <a href="/approvals">Approvals</a>
      </nav>
```

- [ ] **Step 11: Verify tests, typecheck and build**

Run: `pnpm test`
Expected: all pass.

Run: `pnpm typecheck`
Expected: clean.

Run: `pnpm --filter @intabot/web run build`
Expected: succeeds.

- [ ] **Step 12: Commit**

```bash
git add apps/web
git commit -m "feat(web): add upload and approval queue screens"
```

---

## Task 13: Phase 2 smoke test and documentation

**Files:**
- Create: `apps/api/test/phase2-smoke.e2e.test.ts`
- Modify: `README.md`
- Test: the smoke test itself

**Interfaces:**
- Consumes: everything from Tasks 1–12
- Produces: one test proving upload → draft → approve → scan → publish → poll end to end

- [ ] **Step 1: Write the smoke test**

`apps/api/test/phase2-smoke.e2e.test.ts`:

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { FakeCopyWriter } from "../src/content/fake-copy-writer";
import { FakeInstagramAdapter } from "../src/instagram/fake-instagram.adapter";
import { DraftProcessor } from "../src/jobs/draft.processor";
import { PollContainerProcessor } from "../src/jobs/poll-container.processor";
import { PublishProcessor } from "../src/jobs/publish.processor";
import { PublishScanProcessor } from "../src/jobs/publish-scan.processor";
import { QUEUE } from "../src/jobs/queue.constants";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";
import { drainQueues } from "./queue-fixture";

describe("phase 2 smoke", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await drainQueues([QUEUE.draft, QUEUE.publish, QUEUE.pollContainer]);
    app.get(FakeCopyWriter).reset();
    app.get(FakeInstagramAdapter).reset();
  });

  afterAll(async () => { await app.close(); });

  it("carries an upload through drafting, approval and publishing", async () => {
    // 1. Operator and account.
    await app.get(UserRepository).create("op@example.com", await app.get(PasswordService).hash("pw"));
    const login = await request(app.getHttpServer())
      .post("/auth/login").send({ email: "op@example.com", password: "pw" }).expect(200);
    const cookie = login.headers["set-cookie"]!;

    const account = await app.get(AccountRepository).create({
      name: "Studio Nord", igUserId: "1784140", username: "studionord",
      accessTokenEncrypted: "v1:a:b:c", tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    });
    await app.get(AccountRepository).update(account.id, { dryRun: false });

    // 2. Upload.
    const upload = await request(app.getHttpServer())
      .post("/media").set("Cookie", cookie).field("accountId", account.id)
      .attach("file", Buffer.from("jpeg-bytes"), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(202);

    // 3. Draft (the worker is not running in tests, so drive the processor).
    await app.get(DraftProcessor).process({
      accountId: account.id, assetId: upload.body.assetId, format: "IMAGE",
    });

    const queue = await request(app.getHttpServer())
      .get(`/approvals?accountId=${account.id}`).set("Cookie", cookie).expect(200);
    expect(queue.body).toHaveLength(1);
    const draft = queue.body[0];

    // 4. Approve, with a human edit and a slot that is already due.
    const approved = await request(app.getHttpServer())
      .post(`/approvals/${draft.id}/approve`).set("Cookie", cookie)
      .send({
        accountId: account.id,
        expectedVersion: draft.version,
        caption: "Human wrote this.",
        scheduledAt: "2020-01-01T00:00:00.000Z",
      })
      .expect(200);
    expect(approved.body.status).toBe("APPROVED");

    // 5. Scan picks it up.
    expect((await app.get(PublishScanProcessor).process()).enqueued).toBe(1);

    // 6. Publish and poll.
    app.get(FakeInstagramAdapter).setProcessingPolls(1);
    await app.get(PublishProcessor).process({ accountId: account.id, postId: draft.id });
    expect(
      await app.get(PollContainerProcessor).process({ accountId: account.id, postId: draft.id, attempt: 1 }),
    ).toBe("pending");
    expect(
      await app.get(PollContainerProcessor).process({ accountId: account.id, postId: draft.id, attempt: 2 }),
    ).toBe("published");

    // 7. End state.
    const post = await app.get(PostRepository).get(account.id, draft.id);
    expect(post?.status).toBe("PUBLISHED");
    expect(post?.caption).toBe("Human wrote this.");
    expect(post?.permalink).toContain("instagram.test");
    expect(app.get(FakeInstagramAdapter).getPublished()).toHaveLength(1);
    expect(await app.get(PostRepository).listByStatus(account.id, "PENDING_APPROVAL")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run apps/api/test/phase2-smoke.e2e.test.ts`
Expected: PASS. A failure here identifies which earlier task's contract drifted;
fix that task's code rather than this test.

- [ ] **Step 3: Run the whole suite three times**

Run: `pnpm test` three times in a row.
Expected: identical results each run. Any variation means queue or table
isolation is leaking — fix it before committing rather than after.

- [ ] **Step 4: Verify typecheck and both builds**

```bash
pnpm typecheck
pnpm --filter @intabot/api run build
pnpm --filter @intabot/web run build
```

Expected: all three succeed.

- [ ] **Step 5: Update the README**

In `README.md`, replace the phase status list with:

```markdown
- [ ] Phase 0 — Meta app setup (manual; see `docs/meta-setup.md`)
- [x] Phase 1 — foundation
- [x] Phase 2 — Content Agent
- [ ] Phase 3 — Moderation Agent
- [ ] Phase 4 — Analytics
- [ ] Phase 5 — hardening and deploy
```

and add a section after Development:

```markdown
## Trying the content loop

With `pnpm dev` running and an account created:

1. Open <http://localhost:3100/upload>, pick an account, upload a JPEG.
2. The drafting worker writes a caption and picks a slot; the post appears
   at <http://localhost:3100/approvals> within a few seconds.
3. Edit the caption if you like, then Approve.
4. Accounts default to `dryRun: true`, so publishing runs the full state
   machine and stops short of Instagram. Published dry-run posts carry an
   `igMediaId` starting `dryrun-`.

Real caption generation needs `ANTHROPIC_API_KEY` in `.env`; without it the
deterministic `FakeCopyWriter` is used. Real publishing needs Meta setup
(Phase 0) and `dryRun: false` on the account.
```

- [ ] **Step 6: Commit**

```bash
git add apps/api README.md
git commit -m "test: add phase 2 smoke test and document the content loop"
```

---

## Definition of done for Phase 2

- `pnpm test` green across three consecutive runs; `pnpm typecheck` clean; both apps build.
- An upload becomes a `PENDING_APPROVAL` post with a caption and a non-colliding slot, with no Anthropic key present.
- Approval is version-guarded: a stale `expectedVersion` returns 409 rather than overwriting an edit.
- Running the publish job twice against the same post creates exactly one Instagram container.
- A dry-run account completes the whole state machine and never calls `InstagramPort`.
- A container that never finishes fails the post with `failureReason: "container timeout"` rather than polling forever.
