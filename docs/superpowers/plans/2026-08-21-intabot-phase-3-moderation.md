# IntaBot Phase 3 — Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offline-first comment moderation: HMAC webhook receiver → dedupe → classify → policy gate → auto-reply / escalate / ignore, with an escalation screen, audit writes, and a contract-tested real Graph adapter behind `INSTAGRAM_MODE=fake`.

**Architecture:** Plain sequential `ModerationProcessor` in the Phase 2 pattern (no LangGraph). Two new LLM ports (`COMMENT_CLASSIFIER`, `REPLY_WRITER`) with deterministic fakes as DI defaults. Comment rows carry the same conditional-write status+version guards as posts; claim-before-side-effect prevents double replies. `IGM#<igMediaId>` inverse items resolve webhooks to posts.

**Tech Stack:** NestJS 11, BullMQ 5, DynamoDB (Local), zod 3.24, `@anthropic-ai/sdk`, Next.js 15, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-08-21-intabot-phase-3-moderation-design.md`

## Global Constraints

- API port 4100, web 3100, DynamoDB 8200, Redis 6479, MinIO 9200 — never the defaults.
- pnpm 9 / Node ≥22 / TS 5.7 strict, `noUncheckedIndexedAccess`.
- All ids ULIDs. All timestamps ISO strings via `isoDateTime`.
- Never log, return, or persist an access token in plaintext.
- Fakes are DI defaults; credentials opt in (`ANTHROPIC_API_KEY`, `INSTAGRAM_MODE=live`).
- Tests hit real DynamoDB Local + Redis; per-worker tables and queue prefixes; processors driven directly in e2e (workers only start when `NODE_ENV !== "test"`).
- Model for both moderation calls: `claude-opus-5` (classifier adds low effort).
- Commit after every green task; conventional-commit subjects.
- Branch: `feat/phase-3-moderation` off `feat/phase-2-content-agent`.

---

### Task 1: Shared Comment schema + Account policy fields

**Files:**
- Create: `packages/shared/src/schemas/comment.ts`
- Modify: `packages/shared/src/schemas/account.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/schemas/comment.test.ts`, extend `account.test.ts`

**Interfaces (Produces):**
```ts
CommentStatus = z.enum(["RECEIVED","AUTO_REPLIED","ESCALATED","HUMAN_REPLIED","IGNORED"])
ClassificationSchema = z.object({
  sentiment: z.enum(["positive","neutral","negative"]),
  intent: z.enum(["question","praise","complaint","spam","other"]),
  toxicity: z.number().min(0).max(1),
  isSpam: z.boolean(),
  needsHuman: z.boolean(),
})
CommentSchema = z.object({
  igCommentId, accountId, postId, igMediaId, text: z.string(),
  fromIgUserId, fromUsername: z.string().min(1),
  status: CommentStatus, version: z.number().int().nonnegative(),
  classification: ClassificationSchema.optional(),
  policyRule: z.string().optional(),
  replyText: z.string().optional(), replyId: z.string().optional(),
  createdAt: isoDateTime, updatedAt: isoDateTime,
})
// Account additions:
replyCapPerPostPerHour: z.number().int().positive().default(4),
replyCapPerAccountPerHour: z.number().int().positive().default(20),
blocklist: z.array(z.string().min(1)).default([]),
```

- [ ] Write failing tests: valid comment parses; bad status rejected; toxicity 1.2 rejected; account defaults (`replyCapPerPostPerHour` 4, cap 20, blocklist `[]`).
- [ ] `pnpm --filter @intabot/shared test` → FAIL.
- [ ] Implement schema file + account fields + export from `index.ts`.
- [ ] Tests pass; `pnpm typecheck` clean.
- [ ] Commit `feat(shared): add comment schema and account moderation policy fields`.

### Task 2: CommentRepository + IgMediaRef

**Files:**
- Create: `apps/api/src/moderation/comment.repository.ts`, `apps/api/src/moderation/ig-media-ref.repository.ts`, `apps/api/src/moderation/moderation.module.ts` (repos only for now)
- Modify: `apps/api/src/dynamo/keys.ts` (add `igMediaRef`), `apps/api/src/app.module.ts`
- Test: `apps/api/src/moderation/comment.repository.test.ts` (integration, real Dynamo Local)

**Interfaces (Produces):**
```ts
keys.igMediaRef = (igMediaId: string) => ({ PK: `IGM#${igMediaId}`, SK: "#" })
class CommentTransitionConflictError extends Error
CommentRepository.create(input: CreateCommentInput): Promise<Comment | null>  // null = already exists (dedupe layer 2)
CommentRepository.get(postId, igCommentId): Promise<Comment | null>
CommentRepository.listByStatus(accountId, status: CommentStatus, opts?: {limit?, newestFirst?}): Promise<Comment[]>
CommentRepository.transition(args: { postId, igCommentId, accountId, expectedStatus, expectedVersion, nextStatus, patch?: CommentPatch }): Promise<Comment>
  // patch: classification, policyRule, replyText, replyId; GSI1PK rewritten to new status, GSI1SK = createdAt
IgMediaRefRepository.put(igMediaId, {accountId, postId}): Promise<void>       // idempotent overwrite
IgMediaRefRepository.get(igMediaId): Promise<{accountId, postId} | null>
```
`create` starts at `status: "RECEIVED"`, `version: 1`, catches `ConditionalCheckFailedException` → returns `null`. Mirrors `PostRepository.transition` exactly (names/values maps, `ReturnValues: ALL_NEW`, parse with `CommentSchema`).

- [ ] Failing tests: create+get roundtrip; duplicate create returns null; transition bumps version and moves GSI status; stale transition throws `CommentTransitionConflictError`; listByStatus ESCALATED oldest-first and AUTO_REPLIED `newestFirst` with limit; igMediaRef put/get.
- [ ] Implement; wire `ModerationModule` (providers/exports repos) into `AppModule` imports.
- [ ] Green + typecheck. Commit `feat(api): add comment and ig-media-ref repositories`.

### Task 3: Write IGM inverse item at publish time

**Files:**
- Modify: `apps/api/src/jobs/publish.processor.ts` (dry-run path), `apps/api/src/jobs/poll-container.processor.ts` (live PUBLISHED path), `apps/api/src/jobs/jobs.module.ts` (inject repo — import ModerationModule)
- Test: extend `apps/api/test/publish-flow.e2e.test.ts`, `apps/api/test/poll-flow.e2e.test.ts`

Inject `IgMediaRefRepository`; after each `PUBLISHED` transition call `igMediaRefs.put(igMediaId, {accountId, postId})` (dry-run path uses the `dryrun-<ulid>` id too — dry-run comments must still resolve).

- [ ] Failing tests: after dry-run publish, `igMediaRefs.get(post.igMediaId)` returns `{accountId, postId}`; same after live poll-to-published.
- [ ] Implement. Green. Commit `feat(api): resolve ig media ids to posts via inverse items`.

### Task 4: Policy gate + cap counter

**Files:**
- Create: `apps/api/src/moderation/policy-gate.ts`, `apps/api/src/moderation/reply-cap.service.ts`
- Test: `apps/api/src/moderation/policy-gate.test.ts` (pure), `reply-cap.service.test.ts` (real Redis)

**Interfaces (Produces):**
```ts
type GateAction = "reply" | "escalate" | "ignore";
interface GateInput {
  account: Account; fromIgUserId: string; commentText: string;
  classification: Classification | null;   // null only when short-circuited pre-model
  postCapReached: boolean; accountCapReached: boolean;
}
policyGate(input: GateInput): { action: GateAction; rule: string }
// rule strings: "self-reply-guard" | "paused" | "blocklist" | "needs-human" | "spam" | "cap-exceeded" | "default"
ReplyCapService.check(accountId, postId): Promise<{ postCapReached: boolean; accountCapReached: boolean }>
ReplyCapService.increment(accountId, postId): Promise<void>
// Redis keys mod:cap:post:<postId>:<yyyy-mm-ddThh> / mod:cap:acct:<accountId>:<hourBucket>, EXPIRE 3600
```
Rule order per spec §5 (self-reply → paused → blocklist(case-insensitive substring) → needsHuman → isSpam → caps → default).

- [ ] Failing tests: one per rule, plus order tests (self-reply beats everything even with needsHuman classification; blocklist beats needsHuman; caps escalate not ignore; default replies).
- [ ] Cap service tests: below cap → false/false; at `replyCapPerPostPerHour` → postCapReached; account cap likewise; keys expire (assert TTL set > 0).
- [ ] Implement both. Green. Commit `feat(api): add moderation policy gate and reply caps`.

### Task 5: Classifier + reply-writer ports with fakes and Anthropic implementations

**Files:**
- Create: `apps/api/src/moderation/comment-classifier.port.ts`, `fake-comment-classifier.ts`, `anthropic-comment-classifier.ts`, `reply-writer.port.ts`, `fake-reply-writer.ts`, `anthropic-reply-writer.ts`
- Modify: `apps/api/src/moderation/moderation.module.ts` (factory bindings)
- Test: `apps/api/src/moderation/fake-comment-classifier.test.ts`, `fake-reply-writer.test.ts`, `anthropic-moderation.test.ts` (prompt-builder + refusal handling with stubbed client)

**Interfaces (Produces):**
```ts
export const COMMENT_CLASSIFIER = Symbol("COMMENT_CLASSIFIER");
export interface ClassifyInput { commentText: string; postCaption: string; accountVoice: string; }
export interface CommentClassifierPort { classify(input: ClassifyInput): Promise<Classification>; }

export const REPLY_WRITER = Symbol("REPLY_WRITER");
export class ReplyRefusalError extends Error { constructor(readonly category: string) { super(`reply refused: ${category}`); } }
export interface ReplyInput { commentText: string; classification: Classification; postCaption: string; accountVoice: string; }
export interface ReplyWriterPort { draftReply(input: ReplyInput): Promise<{ text: string }>; }
```
Fake classifier keyword rules: text incl. `refund|lawyer|broken|complaint` → `{intent:"complaint", needsHuman:true, sentiment:"negative"}`; `http://|https://|follow me` → `{intent:"spam", isSpam:true}`; `?` → `intent:"question"`; else praise/positive. Hooks `setNextClassification(c)`, `reset()`. Fake reply writer returns `Thanks for the kind words — more from the studio soon.` for praise, `Great question — the caption has details, and we'll follow up.` for question; hooks `setNextReply(text)`, `setNextRefusal(category)`, `reset()`.

Anthropic impls follow `AnthropicCopyWriter` verbatim: `claude-opus-5`, `max_tokens: 1024`, `output_config.format = {type:"json_schema", schema}` (classifier schema mirrors `ClassificationSchema`; reply schema `{text}` required), classifier adds `effort: "low"` in the request; check `stop_reason === "refusal"` before content — classifier maps refusal to `{sentiment:"neutral", intent:"other", toxicity:0, isSpam:false, needsHuman:true}`, reply writer throws `ReplyRefusalError`. Constructor takes `AppConfigService | Anthropic` like the copy writer.

Module bindings (same factory as `COPY_WRITER`): fake unless `config.anthropicApiKey`.

- [ ] Failing tests: fake determinism per rule + hooks; classifier refusal → needsHuman object; reply refusal → throw; prompt builders include voice + caption + comment text.
- [ ] Implement. Green. Commit `feat(api): add comment classifier and reply writer ports`.

### Task 6: Audit repository

**Files:**
- Create: `apps/api/src/audit/audit.repository.ts`, `apps/api/src/audit/audit.module.ts` (`@Global`)
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/audit/audit.repository.test.ts`

**Interfaces (Produces):**
```ts
interface AuditEntry {
  accountId: string; actor: "agent" | "human" | "system"; action: string;
  rule?: string; igCommentId?: string; postId?: string;
  classificationSummary?: string; dryRun?: boolean;
}
AuditRepository.append(entry: AuditEntry): Promise<void>  // SK `<iso ts>#<ulid>`, ttl = now + 90d (epoch seconds)
AuditRepository.list(accountId: string): Promise<Record<string, unknown>[]> // test helper, PK query
```

- [ ] Failing tests: append twice → list returns 2 ordered items with `ttl` ≈ 90 days out; entry fields roundtrip.
- [ ] Implement + wire module. Green. Commit `feat(api): add append-only audit log repository`.

### Task 7: Moderation queue + processor

**Files:**
- Create: `apps/api/src/jobs/moderation.processor.ts`
- Modify: `apps/api/src/jobs/queue.constants.ts` (`moderation: "moderation"`, `MODERATION_QUEUE` symbol), `apps/api/src/jobs/jobs.module.ts`, `apps/api/src/jobs/workers.service.ts` (fifth worker)
- Test: `apps/api/test/moderation-flow.e2e.test.ts`

**Interfaces (Produces):**
```ts
export interface ModerationJobData {
  accountId: string; igCommentId: string; igMediaId: string;
  fromIgUserId: string; fromUsername: string; text: string;
}
ModerationProcessor.process(data: ModerationJobData): Promise<{ outcome: string }>
```
Flow exactly per spec §5: resolve IGM (miss → `{outcome:"unknown-media"}`), load account, `comments.create` (null → `{outcome:"duplicate"}`), self-guard pre-model (transition RECEIVED→IGNORED rule `self-reply-guard`, classification omitted), classify, gate, act:
- reply: `RECEIVED→AUTO_REPLIED` claim storing classification, then `draftReply` (`ReplyRefusalError` → compensating `AUTO_REPLIED→ESCALATED` patch `policyRule:"reply-refused"`, audit, return), then unless `account.dryRun` call `instagram.replyToComment`, then self-transition `AUTO_REPLIED→AUTO_REPLIED` storing `replyText` + `replyId` (`dryrun-<ulid>` when dry), `replyCaps.increment`.
- escalate / ignore: single transition with classification + rule.
Every outcome one `audit.append` (`actor:"agent"`, action = outcome, `dryRun` flagged). `CommentTransitionConflictError` on claim → `{outcome:"already-claimed"}`. Other errors rethrow (BullMQ retry).

- [ ] Failing e2e (drive processor directly, fixtures per Phase 2 style: `resetTables`, `drainQueues`, fake adapter reset): praise comment → `AUTO_REPLIED`, exactly 1 fake reply, cap incremented, audit item; run same job twice → still 1 reply; complaint → `ESCALATED`, no reply; spam → `IGNORED`; blocklisted term → `ESCALATED` pre-needsHuman rule `blocklist`; own `igUserId` → `IGNORED` rule `self-reply-guard` and classifier never called (fake exposes call count — add `getCallCount()` to fake classifier in Task 5 if missing); paused → `IGNORED` rule `paused` with classification stored; dry-run → `AUTO_REPLIED`, `getReplies()` empty, audit `dryRun: true`; cap pre-loaded to limit → `ESCALATED` rule `cap-exceeded`.
- [ ] Implement processor + queue wiring + worker registration (concurrency 4, `attempts: 3, backoff {type:"exponential", delay:2000}` set at enqueue time — Task 8).
- [ ] Green. Commit `feat(api): add moderation processor with policy-gated replies`.

### Task 8: Webhook receiver

**Files:**
- Create: `apps/api/src/webhooks/signature.ts`, `apps/api/src/webhooks/webhook-payload.ts`, `apps/api/src/webhooks/webhooks.controller.ts`, `apps/api/src/webhooks/webhook-seen.repository.ts`, `apps/api/src/webhooks/webhooks.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/webhooks/signature.test.ts`, `webhook-payload.test.ts`, `apps/api/test/webhooks.e2e.test.ts`

**Interfaces (Produces):**
```ts
verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean
  // header "sha256=<hex>"; timingSafeEqual over equal-length buffers; any malformed input → false
parseWebhookEvents(body: unknown): WebhookCommentEvent[]
  // zod-parses Meta comment-webhook shape; returns [] for non-comment changes
interface WebhookCommentEvent { eventId: string; accountIgUserId: string; igCommentId: string;
  igMediaId: string; fromIgUserId: string; fromUsername: string; text: string; }
WebhookSeenRepository.markSeen(eventId): Promise<boolean> // conditional put, false = redelivery; ttl 7d
```
Controller: `GET /webhooks/instagram` (challenge echo / 403); `POST` — 503 if `meta.appSecret`/`verifyToken` unset; 401 on bad signature (log source ip, parse nothing); parse; per event `markSeen` → resolve account by `igUserId` (add `AccountRepository.findByIgUserId` — GSI1 `TYPE#ACCOUNT` scan-filter is fine at this scale) → enqueue `moderation` with `jobId: mod:<igCommentId>`, `attempts: 3`, `backoff {type:"exponential", delay:2000}`; always 200 with `{received: n}`.
Webhook payload shape (fixture, per Meta docs): `{object:"instagram", entry:[{id:"<igUserId>", time, changes:[{field:"comments", value:{id:"<commentId>", media:{id:"<mediaId>"}, from:{id,username}, text}}]}]}`; `eventId` = `<entry.id>:<value.id>`.

- [ ] Failing unit tests: valid signature passes; tampered body fails; missing header fails; wrong length no throw; payload parse extracts event, ignores non-comment field.
- [ ] Failing e2e: GET challenge roundtrip + wrong token 403; POST signed body (sign with test `META_APP_SECRET` env set in test) → 200 + one moderation job enqueued; forged signature → 401, zero jobs; redelivered event → 200, still one WH row, one job; unset secrets → 503. Set `META_APP_SECRET=test-secret`, `META_WEBHOOK_VERIFY_TOKEN=test-verify` in `test/setup-env.ts`.
- [ ] Implement. Green. Commit `feat(api): add hmac-verified instagram webhook receiver`.

### Task 9: Moderation REST

**Files:**
- Create: `apps/api/src/moderation/moderation.controller.ts`
- Modify: `apps/api/src/moderation/moderation.module.ts`
- Test: `apps/api/test/moderation-api.e2e.test.ts`

Routes per spec §6 (`AuthGuard`, zod bodies modeled on `ApprovalsController`):
```ts
GET  /moderation?accountId=   → { escalated: Comment[], recentAutoReplies: Comment[] }  // 400 without accountId
POST /moderation/:igCommentId/reply    body {accountId, postId, expectedVersion, text: z.string().min(1)}
POST /moderation/:igCommentId/dismiss  body {accountId, postId, expectedVersion}
```
Reply: claim `ESCALATED→HUMAN_REPLIED` (conflict → 409), then unless dry-run `instagram.replyToComment`, self-transition storing `replyText`/`replyId`, audit `actor:"human"`, `replyCaps.increment`. Dismiss: `ESCALATED→IGNORED` patch `policyRule:"human-dismissed"`, audit.

- [ ] Failing e2e: 401 unauthenticated; list returns seeded escalated + auto-replied split correctly; reply → 200 `HUMAN_REPLIED` + one fake reply + audit human item; stale version → 409 and no reply sent; dismiss → `IGNORED`; dry-run reply skips port.
- [ ] Implement. Green. Commit `feat(api): add moderation escalation api`.

### Task 10: `/moderation` dashboard screen

**Files:**
- Create: `apps/web/app/(dashboard)/moderation/page.tsx`, `moderation/escalation-card.tsx`, `moderation/actions.ts`
- Modify: `apps/web/app/(dashboard)/layout.tsx` (nav link), `apps/web/lib/api.ts` (`getModeration(accountId)`, types)
- Test: `apps/web/lib/moderation-format.test.ts` (only if a formatter is extracted; otherwise extend `lib/api` types test-free — web tests stay thin per Phase 2)

Patterns copied from `/approvals`: `export const revalidate = 5`; per-account sections via `getAccounts()`; escalation card shows comment text, `@username`, caption snippet (`summarise`), classification chips + `policyRule`, reply `<textarea>` + Reply button and Dismiss button as server actions carrying `expectedVersion`, `revalidatePath("/moderation")`; `ApiError` 409 → return `{error: "This comment changed elsewhere — refresh and retry."}` rendered via `useActionState`; below, read-only "Recent auto-replies" list (comment → reply → chips).

- [ ] Implement (server components; client form component mirrors `approval-card.tsx`).
- [ ] `pnpm --filter @intabot/web build` passes; manual snapshot via `pnpm dev` optional.
- [ ] Commit `feat(web): add moderation escalation screen`.

### Task 11: Real Graph adapter + INSTAGRAM_MODE binding

**Files:**
- Create: `apps/api/src/instagram/graph-instagram.adapter.ts`, `apps/api/src/instagram/graph-responses.ts` (pure parsers), `apps/api/test/fixtures/graph/*.json` (container-created, container-status-{in-progress,finished,error}, publish-success, reply-success, error-oauth)
- Modify: `apps/api/src/instagram/instagram.module.ts`, `apps/api/src/config/env.schema.ts` + `config.service.ts` (`INSTAGRAM_MODE: z.enum(["fake","live"]).default("fake")`), `.env.example`
- Test: `apps/api/src/instagram/graph-responses.test.ts`, `graph-instagram.adapter.test.ts` (injected fetch stub), `instagram.module` binding covered in `apps/api/test/health.e2e.test.ts`-style boot test

**Interfaces (Produces):**
```ts
class GraphInstagramAdapter implements InstagramPort {
  constructor(config: AppConfigService, crypto: TokenCryptoService, fetchImpl: typeof fetch = fetch, baseUrl = "https://graph.instagram.com")
}
parseContainerCreated(json): { containerId }        // {id} → containerId; error shape → GraphApiError(code, message)
parseContainerStatus(json): ContainerStatus         // status_code IN_PROGRESS|FINISHED|ERROR
parsePublish(json): { igMediaId }                   // permalink fetched via GET /<id>?fields=permalink
parseReply(json): { replyId }
class GraphApiError extends Error { constructor(readonly code: number, message: string) }
```
Endpoints: `POST /{igUserId}/media` (image_url or `media_type=REELS` + video_url per format; STORIES for STORY; CAROUSEL throws `NotImplementedError` — deferred per Phase 2 scope), `GET /{containerId}?fields=status_code`, `POST /{igUserId}/media_publish`, `POST /{commentId}/replies`, insights methods throw `NotImplementedError`. `access_token` decrypted per call via `TokenCryptoService.decrypt(account.accessTokenEncrypted)`, sent as body/query param, never logged. Module: `INSTAGRAM_MODE==="live"` (requires `meta.appSecret`, else throw at factory) → Graph adapter, otherwise fake.

- [ ] Failing tests: each parser against its fixture; error fixture → `GraphApiError`; adapter composes URL + token for createContainer/reply (assert via fetch stub, token decrypted not ciphertext); default binding stays fake (boot test asserts `app.get(INSTAGRAM_PORT) instanceof FakeInstagramAdapter`).
- [ ] Implement. Green. Commit `feat(api): add contract-tested graph adapter behind INSTAGRAM_MODE`.

### Task 12: Eval fixture, phase-3 smoke test, docs

**Files:**
- Create: `apps/api/test/fixtures/comment-eval.json` (~30 entries `{text, expected: {intent, isSpam, needsHuman}}` spanning praise/question/complaint/spam/legal/ambiguous), `apps/api/test/classifier-eval.test.ts`, `apps/api/test/phase3-smoke.e2e.test.ts`
- Modify: `README.md` (moderation section + route table + queue table; fix stale `| API | 4000 |` → 4100 while touching the table)

Eval: `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`; real `AnthropicCommentClassifier`; assert ≥ 80% of fixtures match expected `intent` and 100% match on `needsHuman` for the legal/complaint subset.

Smoke (fakes, signed webhooks, processors driven directly):
1. login → account (`dryRun: false`) → seed post + IGM ref as PUBLISHED.
2. Signed praise webhook → run moderation job → comment `AUTO_REPLIED`, one fake reply, audit agent item.
3. Signed complaint webhook → `ESCALATED` → `GET /moderation` shows it → human reply → `HUMAN_REPLIED`, second fake reply, audit human item.
4. Redeliver webhook 2's event → counts unchanged.

- [ ] Failing smoke → implement glue → green.
- [ ] Full `pnpm test` ×3 green, `pnpm typecheck`, both builds.
- [ ] Commit `test: add phase 3 smoke test and comment eval fixture` + `docs: document moderation loop and correct api port table`.

---

## Self-review notes

- Spec §2–§9 each map to tasks: webhook (T8), lifecycle+data (T1–T3), ports (T5), gate+caps (T4), processor+audit (T6–T7), REST+screen (T9–T10), adapter (T11), eval+smoke+exit (T12).
- Type names cross-checked: `Classification`, `GateInput`, `ModerationJobData`, `ReplyRefusalError`, `CommentTransitionConflictError` used consistently.
- Fake classifier `getCallCount()` referenced in T7 — added to T5 deliverables.
