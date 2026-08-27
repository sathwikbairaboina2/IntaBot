# IntaBot

Self-hosted agentic Instagram management for a small number of Business accounts.

- Design: `docs/superpowers/specs/2026-08-14-intabot-design.md`
- Phase 0–1 plan: `docs/superpowers/plans/2026-08-14-intabot-phase-0-1.md`
- Meta setup notes: `docs/meta-setup.md` (written during Phase 0)

## Requirements

- Node.js 22+
- pnpm 9+
- Docker (DynamoDB Local, Redis, MinIO, and Ollama if you want local models)

## Ports

This machine already runs other projects on the conventional ports, so IntaBot
uses its own throughout. Change them in `.env` and `docker-compose.yml` if your
environment differs.

| Service | Port |
| --- | --- |
| API | 4100 |
| Dashboard | 3100 |
| DynamoDB Local | 8200 |
| Redis | 6479 |
| MinIO (API / console) | 9200 / 9201 |
| Ollama | 11437 |

## First run

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# paste the output into TOKEN_ENCRYPTION_KEY in .env

pnpm install
pnpm infra:up
pnpm --filter @intabot/api run create-user you@example.com <password>
```

`create-user` creates the DynamoDB tables if they do not exist yet, so it is
safe as the very first command against a fresh stack.

## Development

```bash
pnpm dev     # API on :4100 and dashboard on :3100 together
```

Or individually:

```bash
pnpm --filter @intabot/api run dev
pnpm --filter @intabot/web run dev
```

Then open <http://localhost:3100> and sign in with the operator you created.

## Trying the content loop

With `pnpm dev` running and an account created:

1. Open <http://localhost:3100/upload>, pick an account, upload a JPEG.
2. The drafting worker writes a caption and picks a slot; the post appears
   at <http://localhost:3100/approvals> within a few seconds.
3. Edit the caption if you like, then Approve.
4. Accounts default to `dryRun: true`, so publishing runs the full state
   machine and stops short of Instagram. Published dry-run posts carry an
   `igMediaId` starting `dryrun-`.

Real caption generation needs a model provider (see below); without one the
deterministic `FakeCopyWriter` is used. Real publishing needs Meta setup
(Phase 0), `INSTAGRAM_MODE=live`, and `dryRun: false` on the account.

## Choosing a model provider

`LLM_PROVIDER` picks what backs the copy writer, the comment classifier and the
reply writer. Leaving it blank keeps the original rule — a present
`ANTHROPIC_API_KEY` means Anthropic, no key means the fakes.

| Value | Backed by | Needs |
| --- | --- | --- |
| `fake` | Deterministic stubs | nothing; the test default |
| `anthropic` | `claude-opus-5` | `ANTHROPIC_API_KEY` |
| `ollama` | A local model | the `ollama` service and one `ollama pull` |

For local models:

```bash
pnpm infra:up
docker exec intabot-ollama ollama pull qwen3.6:27b
# then in .env:
#   LLM_PROVIDER=ollama
#   OLLAMA_MODEL=qwen3.6:27b
```

IntaBot runs its own Ollama container rather than borrowing another project's:
newer Qwen weights refuse to load on an older Ollama, and one stack's model
upgrade must not be able to break another's.

A local model has no equivalent of Anthropic's `stop_reason: "refusal"`, so
unusable output is the only signal it can give. `OllamaClient` retries once and
then raises `OllamaSchemaError`, which each adapter maps onto the existing
human-in-the-loop path: `needsAttention` on a post, `needsHuman` on a
classification, `reply-refused` escalation on a reply. A local model that cannot
answer produces a work item, never a half-formed public reply.

## Trying the moderation loop

Comments arrive via `POST /webhooks/instagram` (HMAC-verified against
`META_APP_SECRET`, deduplicated, enqueued). The moderation worker resolves the
comment to a published post, classifies it, and runs the policy gate:

1. The account's own comments are ignored before classification (self-reply
   guard — the alternative is the bot talking to itself forever).
2. `moderationPaused` accounts classify but never reply.
3. Blocklisted terms, `needsHuman` classifications, and comments past the
   hourly reply caps escalate to <http://localhost:3100/moderation>, where you
   reply or dismiss.
4. Spam is ignored; everything else gets an auto-reply in the account voice.

Every decision — automatic or human — lands on the audit log with the rule
that fired. Classification and reply generation use `claude-opus-5` when
`ANTHROPIC_API_KEY` is set, deterministic fakes otherwise. Reply caps and the
blocklist are per-account fields on `PATCH /accounts/:id`
(`replyCapPerPostPerHour`, `replyCapPerAccountPerHour`, `blocklist`).

Without Meta credentials the webhook route returns 503; the e2e suite signs
its own webhooks with test secrets, so the whole loop still runs offline.

## Tests

```bash
pnpm test          # everything (requires `pnpm infra:up`)
pnpm test:watch
```

Integration tests run against DynamoDB Local. Each Vitest worker gets its own
table (`intabot_main_test_w<N>`), so concurrent test files cannot clobber each
other's rows. All Instagram calls go through `FakeInstagramAdapter` — no Meta
credentials are needed to run the suite.

## Conventions

- **Inject dependencies explicitly.** Always write `@Inject(Token)` in Nest
  constructors. esbuild, which Vitest and tsx use, does not implement
  `emitDecoratorMetadata`, so type-based injection silently yields `undefined`.
- **Entities are defined once** as zod schemas in `packages/shared`; repositories
  parse on read.
- **Instagram access goes through `InstagramPort`.** Nothing outside
  `apps/api/src/instagram/` should know Instagram exists.
- **Never log, return, or persist a token in plaintext.** Tokens are AES-256-GCM
  encrypted via `TokenCryptoService`.

## Phase status

- [ ] Phase 0 — Meta app setup (manual; see `docs/meta-setup.md`)
- [x] Phase 1 — foundation
- [x] Phase 2 — Content Agent
- [x] Phase 3 — Moderation Agent (offline; live adapter behind `INSTAGRAM_MODE`)
- [ ] Phase 4 — Analytics
- [ ] Phase 5 — hardening and deploy
