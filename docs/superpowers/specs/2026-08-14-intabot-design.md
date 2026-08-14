# IntaBot — Agentic Instagram Management Platform

**Status:** Approved design
**Date:** 2026-08-14

## 1. Purpose

A self-hosted platform that manages a small number of Instagram Business accounts
(the operator's own plus a handful of clients). A human uploads media; a Content
Agent drafts the caption and proposes a posting slot; the human approves; the
system handles Instagram's multi-step asynchronous publishing flow. Incoming
comments are classified and answered automatically within a policy envelope, with
escalation to a human when the policy says so. Account and post insights are
collected on a schedule and visualised in a dashboard.

There is no public signup, no billing, and no multi-tenant isolation beyond a
per-account data model.

## 2. Scope decisions

These were settled during design and constrain everything below.

| Decision | Value |
|---|---|
| Tenancy | Few accounts, self-hosted. No signup, no billing. |
| Autonomy | Human approval gate on posts. Moderation replies are automatic within policy. |
| Media source | Human uploads media. The agent writes copy and picks the slot. No media generation. |
| Analytics | Reporting only. No automated strategy adjustment. |
| Agent runtime | `@langchain/langgraph` (TypeScript) in-process inside NestJS. |
| Persistence | DynamoDB (DynamoDB Local in development). |
| Queue | Redis + BullMQ. |
| Object storage | MinIO in development, S3-compatible in production. |
| Deployment | `docker-compose` locally; the same compose file on a single VPS. |
| Meta setup | Nothing exists yet. Phase 0 creates it. |

### 2.1 Rejected alternatives

**A separate Python LangGraph service.** More mature LangGraph, but two runtimes,
two deploy targets, a duplicated Instagram client, and duplicated types. The tax
is not worth it at this scale.

**No agent framework (plain tool-use loop).** Defensible — the Content and
Moderation flows are largely deterministic state machines. Rejected because
LangGraph's `interrupt()` maps directly onto the human approval gate, which is the
one place a graph framework earns its cost here.

## 3. Architecture

Single pnpm monorepo, one deployable pair, one compose file.

```
intabot/
  apps/
    api/                 NestJS — HTTP, webhooks, jobs, agents
    web/                 Next.js dashboard (App Router)
  packages/
    shared/              zod schemas + inferred TS types, used by both
  docker-compose.yml     dynamodb-local, redis, minio
```

### 3.1 `apps/api` modules

| Module | Responsibility |
|---|---|
| `config` | Environment validation (zod), per-account settings |
| `dynamo` | DocumentClient, table bootstrap, repository base class |
| `instagram` | Graph API client, token manager, `InstagramPort` interface with real and fake implementations |
| `media` | Upload to S3/MinIO, issue presigned HTTPS URLs for Graph API fetch |
| `webhooks` | `GET` verification challenge, `POST` receive with HMAC verification, enqueue-then-200 |
| `jobs` | BullMQ queues: `publish`, `poll-container`, `moderation`, `insights-sync`, `token-refresh` |
| `agents` | LangGraph graphs, tool layer, DynamoDB checkpointer |
| `content` | Post lifecycle, drafting orchestration, REST for the dashboard |
| `moderation` | Comment lifecycle, policy gate, REST for the dashboard |
| `analytics` | Insights collection and query, REST for the dashboard |
| `approvals` | Approval queue: list, approve, edit-then-approve, reject, reschedule |
| `audit` | Append-only decision and action log |

### 3.2 Two invariants that keep the system testable

**Agents never call HTTP directly.** LangGraph tools wrap injected Nest services.
Swapping `InstagramPort` to the fake implementation makes the entire agent layer
runnable offline. This is what allows Phases 1 and 2 to proceed while Meta app
setup is still in progress.

**Webhooks verify, enqueue, and return 200 — nothing else.** Meta retries
aggressively on slow or non-2xx responses. All work happens in a worker.

### 3.3 Request flows

```
publish:   web upload → media(S3) → Content graph drafts copy
           → interrupt() → approval queue → human approves
           → resume → jobs:publish → create container → jobs:poll-container
           → status FINISHED → publish → store permalink

comment:   Meta webhook → verify signature → dedupe → enqueue
           → Moderation graph → classify → policy gate
           → reply | escalate | ignore

insights:  cron → jobs:insights-sync → Graph API insights
           → DynamoDB time-series → dashboard reads
```

`apps/web` is a thin client. Server Components read the NestJS REST API. No
direct database access, no business logic in the frontend.

## 4. Data model

Two DynamoDB tables. Single-table design for domain data; a separate table for
agent checkpoints, which have a different churn and TTL profile.

### 4.1 Table `intabot_main`

Primary key `PK`/`SK`, one global secondary index `GSI1PK`/`GSI1SK`.

| Entity | PK | SK | GSI1PK / GSI1SK |
|---|---|---|---|
| Account | `ACCT#<id>` | `#META` | `TYPE#ACCOUNT` / `<name>` |
| MediaAsset | `ACCT#<id>` | `ASSET#<ulid>` | — |
| Post | `ACCT#<id>` | `POST#<ulid>` | `ACCT#<id>#ST#<status>` / `<scheduledAt>` |
| Comment | `POST#<postId>` | `CMT#<igCommentId>` | `ACCT#<id>#CST#<status>` / `<createdAt>` |
| Insights (account) | `ACCT#<id>#INS#ACCOUNT` | `<YYYY-MM-DD>` | — |
| Insights (media) | `ACCT#<id>#INS#MEDIA#<igMediaId>` | `<YYYY-MM-DD>` | — |
| AuditLog | `ACCT#<id>#LOG` | `<ts>#<ulid>` | — (TTL 90 days) |
| WebhookSeen | `WH#<eventId>` | `#` | — (TTL 7 days) |
| Session | `SESSION#<token-hash>` | `#` | — (TTL = session expiry) |

### 4.2 Access patterns

Every dashboard view maps to exactly one query.

| View | Query |
|---|---|
| Approval queue | GSI1 `ACCT#x#ST#PENDING_APPROVAL`, sorted by `scheduledAt` |
| Publish scheduler | GSI1 `ACCT#x#ST#APPROVED`, `scheduledAt <= now` |
| Post history / calendar | GSI1 `ACCT#x#ST#PUBLISHED`, date range on sort key |
| Comments needing a human | GSI1 `ACCT#x#CST#ESCALATED` |
| Analytics charts | `Query PK=ACCT#x#INS#ACCOUNT, SK between date1 and date2` |
| Post detail | `GetItem` on the post + `Query PK=POST#<id>` for its comments |
| Account list | GSI1 `TYPE#ACCOUNT` |

Insights are stored as one daily snapshot item per account holding every metric,
so a 90-day multi-metric chart is a single query rather than one query per metric.

### 4.3 Table `intabot_checkpoints`

`PK=THREAD#<threadId>`, `SK=<checkpointNs>#<checkpointId>`, TTL 30 days. Backs a
custom `BaseCheckpointSaver` implementation (`put`, `putWrites`, `getTuple`,
`list`). Only the Content graph uses it; the Moderation graph runs to completion
inside a single job and never suspends.

### 4.4 Correctness mechanisms

**Double-publish guard.** Every `Post` carries a `version` attribute. Status
transitions are conditional writes:

```
ConditionExpression:
  attribute_exists(PK) AND #status = :expected AND version = :expectedVersion
```

A retried publish job that finds the post already in `PUBLISHING` fails the
condition and no-ops, rather than creating a second Instagram container. This —
not job-level idempotency — is what prevents duplicate posts.

**Webhook deduplication.** Conditional `PutItem` with
`attribute_not_exists(PK)` on `WH#<eventId>`; an existing item means the event is
a redelivery and is dropped. The same guard is applied on `igCommentId` so a
comment is never replied to twice.

**Token storage.** Long-lived Instagram tokens expire after 60 days. They are
stored AES-256-GCM encrypted with a key supplied via environment variable,
decrypted only inside `TokenManager`. Tokens are never logged, never returned in
any API response, and never written to the audit log. A daily job refreshes any
token older than roughly 50 days; a failed refresh moves the account to
`DEGRADED`, pauses publishing for it, and raises a dashboard banner.

**Schema validation at the boundary.** `packages/shared` holds a zod schema per
entity. Repositories parse on read, so a malformed item fails loudly at the
storage boundary rather than deep inside an agent.

## 5. Agents

Only two of the three components are genuinely agentic.

### 5.1 Content Agent

A short-lived graph plus a deterministic publish state machine.

```
Graph (seconds):
  load context (asset metadata, account voice, recent posts)
  → draft copy        [LLM, structured output: caption, hashtags[], altText]
  → propose slot      [deterministic: posting-window table + collision check]
  → interrupt()       ← graph suspends; post status = PENDING_APPROVAL
  → resume on approve/edit → status = APPROVED, enqueue publish

Jobs (minutes):
  publish        → POST /{ig-user-id}/media → store containerId
  poll-container → GET status_code every 15s, max 5 minutes
      FINISHED → POST /media_publish → store igMediaId + permalink
      ERROR    → status FAILED, surface the error code in the dashboard
```

The split is deliberate: LangGraph checkpoints model conversation state, not a
multi-minute polling loop with retries and backoff. BullMQ handles the latter
better.

**Tools available to the Content graph:** `listRecentPosts`, `getAccountVoice`,
`getBestPostingTimes`. Each wraps an injected Nest service.

### 5.2 Moderation Agent

```
webhook → verify → dedupe → enqueue → graph:
  load context (the post, its caption, recent thread, account voice)
  → classify   [LLM, structured: sentiment, intent, toxicity, isSpam, needsHuman]
  → policy gate [deterministic code]
  → reply | escalate | ignore
```

The Moderation graph is given no tools. Its steps are fixed graph nodes, because
tool-choice freedom would only add failure modes to a flow with one correct path.

**The policy gate is plain code, not an LLM decision.** The model classifies; code
decides. Rules, in order:

1. **Self-reply guard.** If `comment.from.id === account.igUserId`, ignore
   immediately. Your own reply fires another webhook; without this check the
   system builds an infinite self-conversation on its own post. This check runs
   before anything else, including classification.
2. Reply cap per post per hour, and a global reply cap per account per hour.
3. Blocklist term match → escalate, never auto-reply.
4. `needsHuman = true` (complaint, legal, purchase dispute, DM-worthy) → escalate.
5. `isSpam = true` → ignore, log.
6. Otherwise → generate reply and post via `POST /{comment-id}/replies`.

### 5.3 Analytics

Not an agent. A scheduled service that calls the insights endpoints and writes
daily snapshot rows. No LLM, no decisions — the feedback loop into content
strategy was explicitly cut from scope. The dashboard names it "Analytics Agent"
for consistency with the product framing; the implementation is a cron job.

### 5.4 Models

Via `@langchain/anthropic` (`ChatAnthropic`).

| Job | Model | Notes |
|---|---|---|
| Caption drafting | `claude-opus-5` | Quality-sensitive, low volume |
| Comment classification | `claude-opus-5`, `effort: "low"` | Substitute `claude-haiku-4-5` if volume cost becomes a concern |
| Reply generation | `claude-opus-5` | Brand voice supplied in the system prompt |

Classification and drafting use structured outputs (`output_config.format`), not
prompt-and-parse.

**Known constraint:** LangChain's `ChatAnthropic` wrapper lags the raw Anthropic
SDK on newer request parameters (`effort`, `output_config`). Where the wrapper
cannot express what a node needs, that node calls `@anthropic-ai/sdk` directly.
This is acceptable — the affected nodes are single calls that need no agent
framework.

## 6. Instagram integration

Meta renames permissions and relocates endpoints frequently. The specifics below
are the intended shape; exact strings are verified against Meta's current
documentation during Phase 0. The `InstagramPort` abstraction is what limits the
blast radius of that churn.

### 6.1 Auth

Use **Instagram API with Instagram Login** (`graph.instagram.com`), which works
against an Instagram professional account without requiring a linked Facebook
Page — fewer moving parts per client account than the Facebook Login path.

Permissions requested: `instagram_business_basic`,
`instagram_business_content_publish`, `instagram_business_manage_comments`,
`instagram_business_manage_insights`.

```
OAuth redirect → short-lived token (1 hour)
  → exchange for long-lived token (60 days)
  → daily job refreshes tokens older than ~50 days
  → refresh failure → account DEGRADED, publishing paused, dashboard banner
```

### 6.2 Publishing

| Format | Flow |
|---|---|
| Image | `POST /{ig-id}/media` (`image_url`, `caption`) → `POST /{ig-id}/media_publish` |
| Reel | `POST /{ig-id}/media` (`media_type=REELS`, `video_url`, `caption`) → poll `status_code` until `FINISHED` → publish |
| Story | As Reel, with `media_type=STORIES` |
| Carousel | One container per child (`is_carousel_item=true`) → parent container (`media_type=CAROUSEL`, `children=[...]`) → publish |

Only video genuinely requires polling, but every format is polled — the call is
cheap and it keeps one code path.

### 6.3 Media URLs

The Graph API fetches media from a URL you host; it does not accept uploads.
Media objects are served via time-limited presigned HTTPS URLs (1 hour, reissued
if a container creation is retried) rather than from a public bucket. Meta only
needs access during the container-creation window.

### 6.4 Webhooks

```
GET  /webhooks/instagram  → echo hub.challenge when hub.verify_token matches
POST /webhooks/instagram  → verify signature → dedupe → enqueue → 200
```

Signature verification requirements. A forged webhook causes the system to post
replies on client accounts, so this path is treated as security-critical:

- Compute `HMAC-SHA256(rawBody, APP_SECRET)` and compare against the
  `X-Hub-Signature-256` header.
- **Hash the raw request bytes.** Nest's default JSON body parser destroys the
  exact byte sequence; the application is created with `rawBody: true` and the
  handler reads `req.rawBody`.
- Compare using `crypto.timingSafeEqual`, never `===`.
- Reject before parsing, logging, or enqueueing anything.
- Return 200 quickly. Meta retries slow or failed deliveries.

### 6.5 Rate limits

Two independent ceilings: a content publishing limit of **50 posts per rolling
24 hours per account**, and a general API call quota. Both are enforced
client-side by a Redis token bucket per account inside the Graph API client, so
the system produces a clean local error and a dashboard warning instead of a 429
in the middle of a publish. The `X-App-Usage` and `X-Business-Use-Case-Usage`
response headers feed the budget state.

### 6.6 `InstagramPort`

```ts
interface InstagramPort {
  createContainer(acct: Account, input: ContainerInput): Promise<{ containerId: string }>;
  getContainerStatus(acct: Account, containerId: string): Promise<ContainerStatus>;
  publishContainer(acct: Account, containerId: string): Promise<{ igMediaId: string; permalink: string }>;
  replyToComment(acct: Account, commentId: string, text: string): Promise<{ replyId: string }>;
  getAccountInsights(acct: Account, metrics: string[], range: DateRange): Promise<InsightPoint[]>;
  getMediaInsights(acct: Account, igMediaId: string): Promise<InsightPoint[]>;
}
```

`FakeInstagramAdapter` implements this with in-memory state and a simulated
container-processing delay, allowing every agent, job, and dashboard flow to be
built and tested before Meta app approval exists.

## 7. Dashboard

Next.js App Router. Server Components fetch from the NestJS REST API using a
server-side service token. The browser never holds an Instagram token and never
talks to DynamoDB.

### 7.1 Authentication

Single-operator login: email and password, Argon2id hashing, session cookie
(`httpOnly`, `secure`, `sameSite=lax`), server-side session record with TTL in
DynamoDB. No signup flow, no password reset in the first version — accounts are
provisioned by a CLI command.

### 7.2 Screens

| Route | Purpose |
|---|---|
| `/` | Account switcher and health: token expiry, publish quota, failed jobs, escalation count |
| `/approvals` | The core screen. Pending posts with media preview, drafted caption, hashtags, proposed slot. Approve, edit-then-approve, reschedule, reject |
| `/upload` | Media upload, creates a `MediaAsset` and triggers the Content graph |
| `/calendar` | Scheduled and published posts by date |
| `/posts/[id]` | Final caption, permalink, media insights, comment thread with the moderation decision for each comment |
| `/moderation` | Escalated comments awaiting a human reply; recent auto-replies with their classifications |
| `/analytics` | Time-series charts: reach, impressions, profile views, follower delta; per-post plays, likes, comments, saves |
| `/settings/[account]` | Brand voice prompt, reply policy (caps, blocklist), posting windows, operational toggles |

Edit-then-approve is a first-class action rather than an afterthought: the
realistic operator loop is correcting one line of an otherwise good caption. The
diff between the drafted and approved text is the primary signal about Content
Agent quality.

### 7.3 Real-time updates

Server-Sent Events (`GET /events/stream`) push post status transitions and job
failures. SSE rather than WebSockets: traffic is one-directional and SSE traverses
proxies with less configuration.

### 7.4 Operational controls (per account)

- **`DRY_RUN`** — agents draft, classify, and decide normally; no call reaches
  Instagram. Intended actions are written to the audit log flagged `dryRun: true`.
  This is the mechanism for building confidence before enabling a client account.
- **`PAUSE_MODERATION`** — kill switch. Webhooks are still received, deduplicated
  and classified, but no reply is posted. Available as a single dashboard toggle,
  because the moment it is needed it must not require a redeploy.

Charts use Recharts, rendered directly from the daily snapshot items.

## 8. Error handling

| Failure | Response |
|---|---|
| Graph API 429 or quota exhaustion | Local token bucket blocks the call first; job retries with backoff informed by usage headers; dashboard shows quota state |
| Graph API 5xx or timeout | BullMQ exponential backoff, 5 attempts, then `FAILED` plus a dashboard alert |
| Container status `ERROR` | Terminal, no retry — Meta has rejected the media. Store the error code, surface it, require a human re-upload |
| Publish job retried after partial success | Conditional-write version check causes a no-op |
| Token refresh failure | Account `DEGRADED`, publishing paused, dashboard banner. No silent retry loop |
| LLM `stop_reason: "refusal"` | Checked before reading response content. Post → needs-human; comment → escalate. Empty content is never treated as an empty caption |
| Structured-output validation failure | One retry, then escalate to a human. No free-text fallback parsing |
| Invalid webhook signature | 401, log the source address, no enqueue and no parse |
| DynamoDB conditional-check failure | Expected control flow. Debug-level log, no alert |

Every agent decision and every Graph API write is appended to the audit log with
account, actor (`agent` / `human` / `system`), an input summary, and the outcome.

## 9. Testing strategy

Test-driven throughout. The fake adapter exists specifically so that tests can be
written before any Meta credentials are available.

- **Unit** — policy gate (with a dedicated self-reply-guard test), version
  transition logic, DynamoDB key builders, HMAC verification including a
  tampered-body case.
- **Integration** — complete flows against `FakeInstagramAdapter` and DynamoDB
  Local running in Docker. Upload → draft → approve → publish → assert final
  state. Webhook → classify → gate → reply.
- **Agent evaluation** — a fixture set of roughly 30 comments with expected
  classifications, executed as part of the test suite. This is the guard against
  prompt regressions, whose alternative discovery path is a client's live account.
- **Contract** — recorded Graph API responses replayed against the real adapter's
  parsing layer, pinning Meta's response shape without live credentials.
- **Explicitly not automated** — the live Graph API. Verified manually against the
  operator's own account during Phase 2, with `DRY_RUN` disabled.

## 10. Delivery phases

| Phase | Delivers | Requires Meta access |
|---|---|---|
| 0 | Meta app created, Instagram accounts connected, OAuth round-trip verified, one manual test post via curl | Yes — runs in parallel with Phase 1 |
| 1 | Monorepo, docker-compose, DynamoDB repositories, `InstagramPort` and fake adapter, authentication, account CRUD, dashboard shell | No |
| 2 | Content Agent: upload → draft → approval queue → approve → publish (fake first, then live) | Live API at the end |
| 3 | Moderation: webhook receiver, policy gate, classification, reply, escalation queue | Yes |
| 4 | Analytics: insights sync, time-series storage, dashboard charts | Yes |
| 5 | Hardening: audit log UI, rate-limit dashboards, backup and restore, VPS deployment | No |

Phase 1 is the largest single unit of work and every later phase depends on it.

**Planning scope.** This document covers the whole system design. The
implementation plan that follows covers **Phases 0 and 1 only**. Phases 2 through
5 receive their own plans when reached — a single plan spanning all five would be
stale before it was half executed.

## 11. Open items

- Exact Meta permission strings and endpoint hosts are confirmed during Phase 0
  against current documentation, then recorded in the Phase 2 plan.
- Instagram posting-window defaults (used by `getBestPostingTimes`) start as a
  static table and are refined once Phase 4 has collected real engagement data.
  No automated adjustment — that is outside the agreed scope.
