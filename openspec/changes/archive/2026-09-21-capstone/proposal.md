# Proposal: CAPSTONE — Business Operations Platform

Change: `capstone` · Project: `temporada-1` · Phase: propose · Artifact store: **hybrid**
Date: 2026-09-18 · Upstream: `exploration.md` (2026-09-17)

## Intent

Flagship of Season 1 — the single production-grade product that proves the full employability stack in one deployable system: **auth/RBAC, transactional integrations (orders↔stock), background jobs, notifications (in-app + real SMTP), audit, observability, CI/CD to production**. It is the ONLY legitimate container: it absorbs Workflow Engine (→ jobs layer), LAB-06/07/08 (→ modules with lab methodology) and Developer Operations Platform (→ observability slice). Deliverable = a deployed, demoable Business Operations Platform with evidence, not a toy.

## Scope

### In Scope — 7 TDD iterations

| # | Iteration | Delivers |
|---|---|---|
| 1 | Foundation + auth/RBAC | Monorepo, DI factory, 5 roles (admin/manager/operator/viewer/auditor), admin-only registration, JWT 15 min + refresh rotation/reuse detection, permission registry |
| 2 | CRM-lite | Customers CRUD/search/status + audit (first full vertical slice) |
| 3 | Orders | Order + lines, status machine, D13 string money, idempotency keys |
| 4 | Stock | Ported ledger (immutable rows, derived views, advisory locks, negative-stock invariant); **order.confirmed → stock out-movements atomically** (showpiece) |
| 5 | Jobs/notifications | pg-boss queues (retries, backoff, dead-letter, job audit); in-app + real SMTP email; event-driven low-stock |
| 6 | Audit + observability + OpenAPI | Append-only audit same-tx; `/api/health` + `/api/status`; pino structured logs; zod-to-openapi docs at `/api/docs` |
| 7 | Production | Multi-stage Docker (non-root, HEALTHCHECK), self-contained appliance (docker compose up = full stack offline), CI/CD → GitHub Container Registry (free), optional deploy → Oracle Cloud Always Free ($0 VPS), docs, evidence dashboard, final repo naming |

**Absorption mapping:** workflow-engine → `modules/jobs` + `modules/notifications` (EVENT→RULE→ACTION, hardcoded v1 rules); LAB-06 → pg-boss queue evidence (retry/dead-letter); LAB-07 → email delivery reliability; LAB-08 → audit module; developer-operations-platform → `modules/observability`.

### Out of Scope (explicit)

Multi-tenancy (no `client_id` design — user-locked), caching, rate limiting, PDFs, webhooks, rules engine, full React frontend in v1 (API-first + MINIMAL verification UI only — user-locked), frontend tests, coverage gate, Redis/BullMQ, exp-02/04/05 reuse.

## Capabilities (contract with sdd-spec)

### New Capabilities
Each becomes `openspec/specs/<name>/spec.md`:

- `user-auth-rbac`: admin-only register; login/logout; 15 min access + 7 d refresh rotation + reuse detection; identical 401; `{module}:{operation}` permission codes (seeded SQL + const registry); per-request DB check → 403
- `crm`: customer CRUD, search, status lifecycle, audit trail
- `orders`: order + lines, status machine, D13 string-numeric totals, idempotency key, confirm → atomic stock movements
- `stock`: immutable movements ledger (qty>0, sign ±1), derived stock views, transfers/adjustments with reason, advisory locks, idempotency keys, negative-stock invariant, low-stock event
- `jobs`: pg-boss queues, retryLimit/backoff/dead-letter, job lifecycle audit, worker entrypoint
- `notifications`: in-app table + real SMTP email; per-type channel mapping; event-driven triggers (order.confirmed, stock.low)
- `audit`: append-only, same-tx writes, never store credentials
- `observability`: health (db ping) + status (version/uptime/db) endpoints; pino request logs with redact
- `api-docs`: OpenAPI generated from zod DTOs, served at `/api/docs`

### Modified Capabilities
None — `openspec/specs/` does not exist yet; no main specs to delta.

## Approach

- **Monorepo** `capstone/` (npm workspaces, own GitHub repo): single `backend` package with **two entrypoints** — `server.ts` (API) and `worker.ts` (pg-boss workers); framework-independent services shared directly.
- **Port, don't reinvent** (Julio's own proven code): `createApp({db,config})` DI, auth module, RBAC registry, ApiError contract, zod v4 `validateDto`, `withTransaction`, idempotent SQL migrations + `migrate.ts`, ledger, audit, test helpers, docker-compose postgres:16.
- **Stack (user-validated):** Express 5 · pg raw + repository pattern · pg-boss v12 · jsonwebtoken + bcryptjs · zod v4 · node:test + supertest · pino (redact) · @asteasolutions/zod-to-openapi v9.
- **Modules** (vertical-slices): `auth, crm, orders, stock, jobs, notifications, audit, observability` — each `routes/controller/service/repository/dto/tests`; controller ≤ 10–15 lines, no business logic; no direct DB outside repository.
- **Events:** `order.confirmed` → stock out-movements (same tx) + notification; movement crossing threshold → `stock.low` event → notification job (event-driven, NO cron — user-locked).
- **Notifications:** each type declares its channel(s) — in-app always; email via **real SMTP** (user-locked; SMTP creds via env only, dev/test via local SMTP sink like mailpit).
- **Minimal UI:** single lightweight verification page (no React in v1) to prove flows end-to-end.

## Preliminary Requirements (per module — spec phase expands)

| Module | Functional (key) | NFR / Security |
|---|---|---|
| Auth/RBAC | Admin-only register; login/logout; refresh rotation + reuse detection; 5 roles; per-request permission check | jwt.verify + exp check; SHA-256 refresh hashes; bcrypt cost 10; identical 401; Secure httpOnly cookies in prod |
| CRM | CRUD, search, status, audit | parameterized queries; permission-gated |
| Orders | Lines; status machine; D13 string totals; idempotency key; confirm → stock movements | no float money; atomic tx with stock |
| Stock | Immutable ledger; derived views; transfers/adjustments w/ reason; low-stock event | advisory locks; negative-stock invariant; idempotency keys |
| Jobs | pg-boss queues; retry/backoff/dead-letter; job audit | worker isolation; idempotent handlers |
| Notifications | In-app rows + SMTP email; channel per type; templates | never log SMTP creds/secrets; pino redact |
| Audit | Append-only; same-tx; auth best-effort | no credentials ever |
| Observability | health + status; request logs | redact; no secrets |
| Cross-cutting | — | parameterized SQL only; zod-validated env (≥ 32 char secrets); strict `tsc --noEmit`; CI on push; multi-stage Docker non-root + HEALTHCHECK |

## Delivery Strategy

- **Iteration order** = dependency order: 1 foundation (everything depends on auth) → 2 CRM (first slice template) → 3 orders → 4 stock (lands the atomic coupling) → 5 jobs/notifications → 6 cross-cutting (audit/obs/docs) → 7 production. Each iteration delivers a complete, functional, verifiable, integrable flow (no layered builds, no integration debt).
- **PR/commit strategy (interactive workflow):** one branch per iteration (`it/1`…`it/7`), PR per iteration against `main`; commits per slice layer (dto → repository → service → controller → routes → tests) with RED→GREEN evidence in messages; merge gate = `tsc --noEmit` + full suite green + evidence doc (`docs/output-*.txt`) updated.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scope creep (absorption rule violated) | High | Strict absorption map; locked defer list; design-critic active in propose/spec |
| Blind copy of inventory-stock code | Med | Design phase decides deltas per module; port consciously, adapt to capstone modules |
| Orders↔stock atomic coupling breaks | Med | Proven primitives (withTransaction, advisory locks, idempotency keys); design decision pre-spec; feature-flag fallback |
| pg-boss learning curve | Med | SKIP LOCKED already proven; LAB-06 methodology; spike inside it5 |
| Real SMTP in dev/test | Med | mailpit for dev/test; real SMTP prod-only via env; creds never in code |
| Deployment unknowns (Oracle free tier account, domain) | Low | Appliance is self-contained and offline-verifiable; live URL is optional, CI pushes image to free GHCR regardless |
| Repo name pending (user decision #9) | Low | Default name recommended below; rename trivial pre-push |

## Rollback Plan

- Per-iteration: PR-based → `git revert` of the PR; migrations additive + idempotent (proven `migrate.ts`) — code revert leaves harmless migrations.
- Coupling failure: revert to confirm-without-stock-movement behind flag, restore after fix.
- Production: keep previous Docker image tag; rollback = redeploy previous tag; DB backup before first prod deploy.
- `capstone/` is a NEW folder — prior projects (inventory-stock, labs) untouched; worst case, abandon folder.

## Dependencies

- User (checkpoint): repo name (decision #9 — RESOLVED: business-operations-platform) + SMTP credentials (real SMTP, decision #3) + Oracle Cloud Always Free account (optional, only for live URL)
- Proven code: inventory-stock (port source). New: pg-boss v12, @asteasolutions/zod-to-openapi v9. Infra: PostgreSQL 16 (docker-compose).

## Product Name (decision #9 — RESOLVED: user confirmed 2026-09-18)

**Business Operations Platform** — the repo and product carry the real descriptive name (NOT "capstone", NOT a brand name). Repo slug: `business-operations-platform` (applied at repo creation).

## Success Criteria

- [ ] 7 iterations delivered, all green (node:test + supertest), evidence docs per iteration
- [ ] End-to-end demo: customer → order confirm → atomic stock movement → in-app + email notification → audit rows
- [ ] Self-contained appliance verified: `docker compose up` runs full stack offline (API + worker + Postgres + UI) on localhost; `/api/health` + `/api/status` green
- [ ] CI/CD publishes image to GitHub Container Registry (free); optional live deploy on Oracle Cloud Always Free ($0) documented and reproducible
- [ ] OpenAPI docs at `/api/docs`; audit append-only with zero credentials stored
- [ ] Repo named per user decision #9; evidence dashboard updated