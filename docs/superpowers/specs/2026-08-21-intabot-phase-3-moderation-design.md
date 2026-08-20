# IntaBot Phase 3 — Moderation Design

**Status:** Approved design
**Date:** 2026-08-21
**Parent spec:** `2026-08-14-intabot-design.md` §5.2, §6.4, §7.2, §7.4

## 1. Scope

Comment moderation, offline-first. Ships:

- Webhook receiver: verification challenge, HMAC-verified POST, dedupe, enqueue-then-200.
- Comment lifecycle in DynamoDB with the same conditional-write version guards as posts.
- Classification and reply-writing behind ports; Anthropic implementations opt in via
  `ANTHROPIC_API_KEY`, deterministic fakes are the default.
- Policy gate as pure code: self-reply guard, pause switch, blocklist, needs-human,
  spam, reply caps.
- Escalation queue REST + `/moderation` dashboard screen (human reply, dismiss).
- Audit log writes (no UI) for every moderation decision, human or agent.
- Real `GraphInstagramAdapter`, contract-tested against recorded fixtures, selectable
  via `INSTAGRAM_MODE=fake|live` (default `fake`). Not exercised live this phase.

Out of scope: Phase 0 Meta app setup (separate manual task), live webhook delivery
(needs public HTTPS), insights methods on the real adapter (Phase 4), audit log UI
and rate-limit token bucket (Phase 5), moderation of comments on media IntaBot did
not publish.

Decisions settled during brainstorm: offline-first; policy config as Account fields
via existing `PATCH /accounts/:id` (no settings screen); full `/moderation` screen;
audit writes on. Orchestration is a plain sequential processor in the Phase 2
pattern — LangGraph stays out (one branch point, nothing suspends; the comment row
is the durable "awaiting a human" record), and classification and reply generation
stay separate LLM calls so the gate remains code deciding between model steps.

## 2. Webhook receiver

`WebhooksModule` → `WebhooksController`, no auth guard.

- `GET /webhooks/instagram`: echo `hub.challenge` when `hub.verify_token` matches
  `META_WEBHOOK_VERIFY_TOKEN`; otherwise 403.
- `POST /webhooks/instagram`, strict order:
  1. HMAC-SHA256 over `req.rawBody` with `META_APP_SECRET`, compared to
     `X-Hub-Signature-256` via `crypto.timingSafeEqual`. Mismatch or missing header
     → 401, log source address, nothing parsed or enqueued.
  2. Minimal zod parse; extract comment change events (comment id, media id, ig user
     id of author, text, event id).
  3. Per event: conditional `PutItem` `WH#<eventId>` with
     `attribute_not_exists(PK)`, TTL 7 days. Condition failure = redelivery, drop.
  4. Enqueue queue `moderation`, `jobId: mod:<igCommentId>`, payload
     `{accountId, igCommentId, igMediaId, fromIgUserId, fromUsername, text}`.
  5. Return 200 fast. All work happens in the worker.
- `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN` stay optional in the env schema;
  the controller returns 503 when they are unset so offline installs boot clean.

## 3. Data model

`Comment` in `@intabot/shared`:
`igCommentId, accountId, postId, igMediaId, text, fromIgUserId, fromUsername,
status, classification?, policyRule?, replyText?, replyId?, version, createdAt,
updatedAt`.

`CommentStatus = RECEIVED | AUTO_REPLIED | ESCALATED | HUMAN_REPLIED | IGNORED`.

`classification` is the embedded object exactly as classified:
`{sentiment: positive|neutral|negative, intent: question|praise|complaint|spam|other,
toxicity: 0..1, isSpam: boolean, needsHuman: boolean}`.

Keys (already in `dynamo/keys.ts`): `PK POST#<postId>`, `SK CMT#<igCommentId>`,
`GSI1PK ACCT#<id>#CST#<status>`, `GSI1SK <createdAt>`.

`CommentRepository` mirrors `PostRepository`: `create` (conditional,
`attribute_not_exists`), `transition` with status+version `ConditionExpression`
throwing `CommentTransitionConflictError`, `listByStatus` via GSI1.

**Media → post resolution.** The webhook carries an ig media id, not a post ULID.
At publish time (both live and dry-run paths) the publish/poll flow writes an
inverse item `PK IGM#<igMediaId>`, `SK #`, attrs `{accountId, postId}`. The worker
resolves with one `GetItem`; a miss means the comment is on media IntaBot did not
publish — log and stop.

**Account policy fields** (all optional, defaulted in the schema):
`replyCapPerPostPerHour: 4`, `replyCapPerAccountPerHour: 20`, `blocklist: []`.
Editable through the existing `PATCH /accounts/:id`. `moderationPaused` already
exists.

## 4. Ports

`COMMENT_CLASSIFIER` — `classify({commentText, postCaption, accountVoice}) →
Classification`. Anthropic implementation: `claude-opus-5`, low effort, JSON-schema
constrained output; `stop_reason: "refusal"` → return
`{needsHuman: true, intent: "other", sentiment: "neutral", toxicity: 0,
isSpam: false}` (a comment the model refuses to touch is a human's by definition).
Fake: keyword-driven and deterministic (`"refund"`/`"lawyer"` → complaint +
needsHuman, `"http://"` → spam, default praise/neutral), with `setNextClassification()`
/ `reset()` test hooks.

`REPLY_WRITER` — `draftReply({commentText, classification, postCaption,
accountVoice}) → {text}`. Anthropic implementation with the voice in the system
prompt; refusal throws `ReplyRefusalError`, which the processor converts to
escalation (`rule: "reply-refused"`). Fake deterministic with `setNextReply()`.

Both bound in `ModerationModule` with the Phase 2 factory pattern: fake is the
default, `ANTHROPIC_API_KEY` opts in to the real implementation.

## 5. Policy gate and processor

`policyGate(input) → {action: "reply" | "escalate" | "ignore", rule: string}` —
pure function, rules in order:

1. `fromIgUserId === account.igUserId` → ignore, `self-reply-guard`. Evaluated in
   the processor **before classification**; the model is never called.
2. `account.moderationPaused` → ignore, `paused` (classification still runs and is
   stored — the kill switch stops replies, not visibility).
3. Case-insensitive blocklist term in comment text → escalate, `blocklist`.
4. `classification.needsHuman` → escalate, `needs-human`.
5. `classification.isSpam` → ignore, `spam`.
6. Per-post or per-account hourly cap reached → escalate, `cap-exceeded` (a capped
   genuine question still deserves a human, so escalate rather than drop).
7. Otherwise → reply, `default`.

Caps count via Redis `INCR` + 1-hour `EXPIRE` on
`mod:cap:post:<postId>:<hourBucket>` and `mod:cap:acct:<accountId>:<hourBucket>`,
incremented only after a successful reply (or a dry-run reply decision).

`ModerationProcessor` (queue `moderation`, 3 attempts, exponential backoff 2 s):

```
resolve IGM#<igMediaId> ── miss → log, done
→ create comment RECEIVED (conditional; exists → done — dedupe layer 2)
→ self-reply guard (pre-model)
→ classify (port)
→ policy gate
→ act:
    reply:    claim RECEIVED → AUTO_REPLIED (version guard, stores classification)
              → draftReply → replyToComment via INSTAGRAM_PORT
              → self-transition storing replyText + replyId
    escalate: RECEIVED → ESCALATED (stores classification + rule)
    ignore:   RECEIVED → IGNORED (stores classification when run + rule)
```

`account.dryRun` runs the full pipeline but skips `replyToComment`; the comment
still reaches `AUTO_REPLIED` with a synthetic reply id `dryrun-<ulid>` and the
audit item is flagged `dryRun: true`.

Claim-before-side-effect is the double-reply guard, same as publish: the losing
racer hits `CommentTransitionConflictError` and stops. Non-refusal model errors
rethrow so BullMQ retries.

**Audit.** Every outcome — agent or human — appends one item at
`PK ACCT#<id>#LOG`, `SK <ts>#<ulid>`, TTL 90 days:
`{actor: "agent" | "human", action, rule, igCommentId, postId,
classificationSummary, dryRun}`. `AuditRepository.append` only; no read API this
phase.

## 6. Moderation REST and screen

REST (`ModerationController`, `AuthGuard`):

- `GET /moderation?accountId=` → `{escalated: Comment[], recentAutoReplies:
  Comment[]}` — escalated oldest-first, auto-replies newest-first capped at 20.
  Missing `accountId` → 400.
- `POST /moderation/:igCommentId/reply` — body `{accountId, postId,
  expectedVersion, text}`. Claims `ESCALATED → HUMAN_REPLIED` (stale → 409), calls
  `replyToComment` (dry-run skips), stores `replyText`/`replyId`, audits
  `actor: "human"`.
- `POST /moderation/:igCommentId/dismiss` — `{accountId, postId, expectedVersion}`
  → `ESCALATED → IGNORED`, rule `human-dismissed`, audited.

Screen `/moderation` (Next.js, `revalidate = 5`, patterns copied from
`/approvals`): per-account sections; escalation cards with comment text, author,
post caption snippet, classification chips, the rule that escalated, a reply
textarea + Reply button and a Dismiss button (server actions carrying
`expectedVersion`; 409 surfaces "changed elsewhere — refresh"); below, a read-only
list of recent auto-replies with their classifications. Nav gains "Moderation".

## 7. Real Graph adapter

`GraphInstagramAdapter implements InstagramPort` against
`https://graph.instagram.com` (base URL injectable for tests). Constructor takes
config + `TokenCryptoService` + a `fetch` implementation. Implements
`createContainer`, `getContainerStatus`, `publishContainer`, `replyToComment`
(insights methods throw `NotImplementedError` until Phase 4). Decrypts the account
token per call; never logs it. Response parsing is a separate pure layer,
contract-tested against recorded JSON fixtures in
`apps/api/test/fixtures/graph/` (success + error shape per endpoint).

Binding: `INSTAGRAM_MODE` env (`fake` | `live`, default `fake`) selects the
adapter in `InstagramModule`. `live` additionally requires `META_APP_SECRET`.
Nothing in this phase runs `live`.

## 8. Testing

- **Unit:** policy gate (dedicated self-reply-guard test, every rule, order),
  HMAC verification (valid, tampered body, missing header, timing-safe path),
  cap counter, comment key builders, classifier/reply fakes, Graph response
  parsing against fixtures, webhook payload parsing.
- **E2E** (real DynamoDB Local + Redis, processors driven directly):
  forged signature → 401 and nothing enqueued; valid webhook → comment
  `AUTO_REPLIED` with exactly one reply on the fake port; redelivered event →
  still one reply; `needsHuman` fixture → `ESCALATED`; blocklist → `ESCALATED`
  without reply; spam → `IGNORED`; paused account → classified but no reply;
  dry-run account → `AUTO_REPLIED`, port untouched, audit flagged; human reply →
  `HUMAN_REPLIED` + 409 on stale version; caps → escalation past the limit;
  phase-3 smoke test walking webhook → auto-reply and webhook → escalate →
  human reply end to end.
- **Eval:** ~30-comment fixture set with expected classifications, runs only when
  `ANTHROPIC_API_KEY` is present (`describe.skipIf`), guarding against prompt
  regressions.
- **Not automated:** live Graph API, live webhook delivery.

## 9. Exit criteria

- `pnpm test` green (three consecutive runs) and `pnpm typecheck` clean; both apps
  build.
- With no Anthropic key and no Meta secrets: a simulated webhook (signed with test
  secrets) drives a comment to `AUTO_REPLIED` through the fakes.
- A redelivered webhook event and a double-run moderation job each produce exactly
  one reply.
- Blocklist, needs-human, spam, pause, dry-run, and cap behaviours each covered by
  a passing e2e test.
- Human reply flow returns 409 on a stale version and never double-posts.
- Every moderation outcome writes exactly one audit item.
- `INSTAGRAM_MODE=fake` default preserves all Phase 1–2 behaviour unchanged.
