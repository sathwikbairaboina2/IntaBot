# IntaBot

Self-hosted agentic Instagram management for a small number of Business accounts.

- Design: `docs/superpowers/specs/2026-08-14-intabot-design.md`
- Phase 0–1 plan: `docs/superpowers/plans/2026-08-14-intabot-phase-0-1.md`
- Meta setup notes: `docs/meta-setup.md` (written during Phase 0)

## Requirements

- Node.js 22+
- pnpm 9+
- Docker (DynamoDB Local, Redis, MinIO)

## Ports

This machine already runs other projects on the conventional ports, so IntaBot
uses its own throughout. Change them in `.env` and `docker-compose.yml` if your
environment differs.

| Service | Port |
| --- | --- |
| API | 4000 |
| Dashboard | 3100 |
| DynamoDB Local | 8200 |
| Redis | 6479 |
| MinIO (API / console) | 9200 / 9201 |

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
pnpm dev     # API on :4000 and dashboard on :3100 together
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

Real caption generation needs `ANTHROPIC_API_KEY` in `.env`; without it the
deterministic `FakeCopyWriter` is used. Real publishing needs Meta setup
(Phase 0) and `dryRun: false` on the account.

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
- [ ] Phase 3 — Moderation Agent
- [ ] Phase 4 — Analytics
- [ ] Phase 5 — hardening and deploy
