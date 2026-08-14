# IntaBot Phase 2 — Content Agent

**Status:** Approved design
**Date:** 2026-08-15
**Extends:** `docs/superpowers/specs/2026-08-14-intabot-design.md`

This is an addendum, not a replacement. The platform design still holds; this
document records the Phase 2 decisions that refine it, and explicitly marks the
one place where Phase 1 experience overturned an earlier choice.

## 1. What Phase 2 delivers

A human uploads media; the Content Agent drafts a caption and proposes a
posting slot; the post lands in an approval queue; on approval it is scheduled;
a worker publishes it at the slot through Instagram's asynchronous container
flow. The entire loop is buildable, testable, and demonstrable with **no Meta
credentials and no Anthropic API key** — both live integrations sit behind ports
with fakes, exactly as `InstagramPort` did in Phase 1.

## 2. Decisions, including one supersession

### 2.1 The LangGraph checkpointer is dropped (supersedes §5.1 and §4.3)

The Phase 1 spec justified LangGraph specifically because `interrupt()` maps
onto the human approval gate, and specified a custom `BaseCheckpointSaver` over
`intabot_checkpoints`.

Phase 1 delivered `PostRepository.transition()` with a conditional-write version
guard. The post row is therefore already a durable record of exactly where a
post sits, including "suspended awaiting a human". Adding a checkpointer would
create a **second source of truth for the same fact**, with no mechanism to keep
the two in agreement.

Decision: **no checkpointer.** Drafting is a short one-shot graph that ends by
writing a `PENDING_APPROVAL` row. Approval is a REST call. Publishing is a job.
Nothing suspends, so nothing needs resuming.

Consequences:

- `intabot_checkpoints` is created by `ensureTables` and has no consumer. It
  stays, unused, rather than churning the bootstrap. Phase 3 decides its fate.
- LangGraph now structures a three-node linear flow and nothing more. It is
  retained for readability, on the explicit understanding that if it reads as
  ceremony once the code exists, removing it is a small change and should be
  proposed at that point rather than left to accumulate.

### 2.2 Media hosting: MinIO now, S3/R2 at go-live

Instagram fetches media from a URL it can reach; `localhost:9200` is not one.
Phase 2 builds upload → MinIO → presigned URL behind a `MediaStoragePort`, and
tests it against the fake Instagram adapter where reachability is irrelevant.
Swapping to S3 or Cloudflare R2 at go-live is an adapter plus configuration
change. No cloud account is required to build or test Phase 2.

### 2.3 Drafting is triggered automatically by upload

Upload creates the `MediaAsset` and enqueues a drafting job immediately. The
operator's loop is one action, and `/approvals` is the single place they work.
The cost is one LLM call per upload, including uploads later rejected.

### 2.4 Approval schedules; a scheduler publishes

Approve sets `APPROVED` with a `scheduledAt`. A repeatable job scans
`GSI1 ST#APPROVED` for posts due now and enqueues publishing. This uses the
index Phase 1 already built, and means posting times are chosen rather than
incidental. It requires the process to be running at the slot time, which is
acceptable for a self-hosted tool on a VPS.

## 3. New modules

All in `apps/api`, following the Phase 1 pattern of port, fake, repository, thin
controller.

| Module | Responsibility |
|---|---|
| `media/` | `MediaStoragePort`, `MinioStorageAdapter`, `MediaAssetRepository`, `POST /media` |
| `content/` | `CopyWriterPort`, `FakeCopyWriter`, `AnthropicCopyWriter`, drafting graph, `SlotPlanner` |
| `jobs/` | BullMQ queue registry, worker bootstrap, four processors |
| `approvals/` | Approval queue REST surface |

### 3.1 Ports

```ts
interface MediaStoragePort {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  presignedUrl(key: string, ttlSeconds: number): Promise<string>;
}

interface CopyWriterPort {
  draft(input: DraftInput): Promise<DraftOutput>;
}

interface DraftInput {
  accountVoice: string;
  format: PostFormat;
  recentCaptions: string[];
  mediaMeta: { contentType: string; widthPx?: number; heightPx?: number; durationSeconds?: number };
}

interface DraftOutput {
  caption: string;
  hashtags: string[];
  altText: string;
}
```

`FakeCopyWriter` returns deterministic output so the Phase 2 suite runs offline.
`AnthropicCopyWriter` uses `claude-opus-5` with structured outputs
(`output_config.format`), so the shape is guaranteed rather than parsed out of
prose. Its behaviour is not covered by automated tests; it is a thin translation
layer verified during live testing.

### 3.2 Schema additions

Phase 2 adds fields to two existing `packages/shared` schemas. Both are
optional, so existing rows parse unchanged.

| Schema | Field | Meaning |
|---|---|---|
| `PostSchema` | `needsAttention?: boolean` | Copy generation refused or failed validation; the post reached the queue with empty copy for a human to write |
| `PostSchema` | `altText?: string` | Accessibility text produced alongside the caption |
| `PostSchema` | `dryRun?: boolean` | This post was published in dry-run mode and never reached Instagram |
| `MediaAssetSchema` | `draftFailed?: boolean` | Drafting exhausted its retries; the asset is in the library awaiting manual drafting |
| `AccountSchema` | `voice?: string` | Brand-voice prompt fragment passed to the copy writer |
| `AccountSchema` | `timezone?: string` | IANA zone for slot planning; defaults to `UTC` |
| `AccountSchema` | `postingWindows?: string[]` | `HH:mm` local times; defaults to `["09:00", "12:30", "18:00"]` |

### 3.3 Queues

| Queue | Trigger | Work |
|---|---|---|
| `draft` | Upload completed | Run drafting, write `PENDING_APPROVAL` |
| `publish-scan` | Repeatable, 60s | Find due `APPROVED` posts, enqueue `publish` |
| `publish` | From scan | Claim the post, create container |
| `poll-container` | After publish | Poll status, publish or fail |

Workers run in the same Nest process as the API. Splitting them out is a
configuration change if it ever becomes necessary.

## 4. Flows

### 4.1 Upload

```
POST /media (multipart)
  validate mime allowlist and size cap, infer format
  → MediaStoragePort.put(key)
  → MediaAsset row
  → enqueue draft { assetId }
  → 202 { assetId }
```

### 4.2 Draft job

```
load account voice + last ~10 published captions
  → CopyWriterPort.draft(...)
  → SlotPlanner.nextFreeSlot(account)
  → PostRepository.create(...)              [DRAFT v1]
  → transition DRAFT → PENDING_APPROVAL     [v2]
```

`SlotPlanner` is a pure function over a per-account window table (default:
weekdays 09:00, 12:30, 18:00 in the account's timezone). It returns the first
window at least 30 minutes out with no post already scheduled within ±30
minutes.

### 4.3 Approve

`POST /approvals/:id/approve` carries `expectedVersion` and optional edited
`caption`, `hashtags`, or `scheduledAt`. It calls
`transition(PENDING_APPROVAL → APPROVED, expectedVersion, patch)`. A stale tab
or a second operator receives `409` from the version guard rather than
overwriting an edit.

### 4.4 Publish and poll

```
publish-scan (repeatable, 60s)
  → GSI1 ST#APPROVED where scheduledAt <= now
  → enqueue publish, jobId = publish:<postId>:<version>

publish
  → transition APPROVED → PUBLISHING          [claim first]
  → InstagramPort.createContainer(...)         [then side effect]
  → patch containerId
  → enqueue poll-container (delay 15s)

poll-container
  IN_PROGRESS → re-enqueue, 15s delay, max 20 attempts
  FINISHED    → publishContainer → transition PUBLISHING → PUBLISHED
  ERROR       → transition PUBLISHING → FAILED (failureReason)
```

**Claim before side effect is mandatory.** The conditional transition to
`PUBLISHING` must succeed before `createContainer` is called. A duplicated job,
a retry after a crash, or two racing workers then produce exactly one container:
the loser fails the version check and no-ops. Creating the container first and
transitioning afterwards would leak a container on every retry — precisely the
failure the version guard exists to prevent.

### 4.5 Dry run

`account.dryRun` defaults to true. The publish job follows the same path but
never calls `InstagramPort`. It writes an audit entry marked `dryRun: true` and
lands the post at `PUBLISHED` with `igMediaId = "dryrun-<ulid>"` and no
permalink, which the dashboard badges.

Leaving dry-run posts at `APPROVED` was rejected: the scan queue would refill
indefinitely, and the operator could not see what would have shipped. Running
them to `PUBLISHED` exercises the whole state machine before a real account is
ever involved.

## 5. Error handling

Additions to the Phase 1 table.

| Failure | Response |
|---|---|
| Upload rejected (mime, size) | 400 before anything is stored; nothing enqueued |
| Copy writer refusal (`stop_reason: "refusal"`) | Post reaches `PENDING_APPROVAL` with empty copy and a `needsAttention` flag; never an empty string presented as a finished draft |
| Structured-output validation failure | One retry, then the post still reaches the queue with empty copy for a human to write |
| LLM or network error while drafting | Backoff, 3 attempts, then the asset shows `draftFailed` in the library so it is not lost |
| Container stuck `IN_PROGRESS` past 20 polls | `FAILED` with `failureReason: "container timeout"`; media retained for retry |
| Edit attempted after publishing began | Impossible by construction; `PUBLISHING` has claimed the post and the version has moved |
| Redis unavailable | Uploads still succeed and assets persist; drafting resumes on recovery; publishing pauses rather than double-firing |

## 6. Testing

- **Unit** — `SlotPlanner` window arithmetic, collision avoidance, timezone
  edges; copy-writer output validation; upload validation.
- **Integration** — the full loop against `FakeCopyWriter`, `FakeInstagramAdapter`,
  real DynamoDB Local and real Redis: upload → draft → approve → scan →
  publish → poll → `PUBLISHED`. Adversarial cases: double approval, duplicate
  publish job, crash between claim and container creation.
- **Isolation** — BullMQ queues take a per-worker prefix, matching the
  per-worker DynamoDB table names introduced in Phase 1. This is applied from
  the first queue test, not retrofitted after a flaky suite.
- **Not covered** — `AnthropicCopyWriter` and the real Instagram adapter. Both
  are thin translation layers verified during live testing.

## 7. Dashboard

`/upload` with drag-and-drop and a drafting-in-progress indicator; `/approvals`
with media preview, editable caption and hashtags, and approve / reject /
reschedule; a dry-run badge on published posts; post detail gaining permalink
and publish timeline.

Server-Sent Events are deferred to Phase 5. Phase 2 polls every five seconds —
one less moving part while the queues are new.

## 8. Out of scope for Phase 2

- Live publishing to a real Instagram account (blocked on Meta setup, which is
  manual and belongs to the operator).
- Real caption generation running against the Anthropic API (needs
  `ANTHROPIC_API_KEY`; the adapter is written and typechecked, its tests use the
  fake).
- Carousel publishing. Single image, reel, and story only. Carousel needs child
  containers and is deferred until the single-container path is proven live.
- Any analytics or moderation behaviour.

## 9. Exit criteria

- `pnpm test` green, `pnpm typecheck` clean, both apps build.
- A full upload → draft → approve → scheduled dry-run publish cycle
  demonstrable in the running app with zero external credentials.
- Duplicate publish jobs and concurrent approvals both provably produce one
  outcome, covered by tests.
