# Exploration: CAPSTONE — Business Operations Platform

Change: `capstone` · Project: `temporada-1` · Phase: explore (investigation only — no code created)
Artifact store: **hybrid** (engram `sdd/capstone/explore` + `openspec/changes/capstone/exploration.md`)
Date: 2026-09-17

## Current State

- `capstone/` contains only `README.md` (idea: Business Operations Platform, "start from Inventory & Stock Management and grow", must be the flagship of Season 1).
- Strategic decisions (2026-09-16/17, engram #1393/#1396) already set: scope = auth/RBAC → CRM-lite → orders → stock → jobs/notifications → audit, deploy to production with CI/CD + multi-stage Dockerfile. The capstone absorbs Workflow Engine (jobs layer), LAB-06/07/08 (as modules with lab methodology), Developer Operations Platform (minimal observability slice), and EXP-03 only if the jobs layer demands it.
- `proyectos-profesionales/inventory-stock/` — DELIVERED (138/138 tests, own GitHub repo). npm workspaces monorepo (`backend` Express 5 + pg + zod + jsonwebtoken + bcryptjs + cookie-parser + supertest; `frontend` React 19 + Vite 6 + react-router 7). This is the proven foundation the capstone grows from.
- `experimentos/` — exp-02 (mini ORM, ✅ on `node:sqlite`), exp-04 (mini HTTP framework, ✅ Express-5 clone), exp-05 (storage engine, ✅), exp-03 (message queue, 🔲 idea only).
- `laboratorios-ingenieria/lab-05..08` — lab-05 caching ✅ complete; lab-06/07/08 are scaffolds (README + .gitkeep only).
- `proyectos-profesionales/workflow-engine` and `developer-operations-platform` — README only (to be absorbed).
- Workspace conventions: TS/Node ESM, strict tsc --noEmit only (no build step, no eslint/prettier), node:test runner, PostgreSQL via docker-compose (pg driver), strict TDD active, evidence culture (docs/output-*.txt), neutral Spanish for user-facing output.

## Affected Areas

- `capstone/` — the folder becomes the new monorepo (backend + frontend + infra).
- `proyectos-profesionales/inventory-stock/backend/src/` — source of proven patterns to port: `app.ts` (DI factory), `modules/auth/*` (JWT rotation + RBAC), `modules/audit/*`, `modules/movements/*` (ledger + advisory locks + idempotency), `middleware/*`, `db/*` (pool, transaction, idempotent SQL migrations + migrate.ts), `permissions/registry.ts`.
- `laboratorios-ingenieria/lab-06..08/` — methodologies absorbed as capstone modules (jobs, retry/failure, audit). Scaffolds stay as-is (referenced, not copied).
- `proyectos-profesionales/workflow-engine/` + `developer-operations-platform/` — READMEs stay; their content becomes capstone's jobs/notifications layer and observability slice.
- `experimentos/exp-02` — assessed NOT reusable (node:sqlite, not pg). exp-04 assessed NOT production-appropriate for the flagship.
- `openspec/changes/capstone/` — created for this exploration; proposal/specs/design/tasks will follow.

## Reusable Assets Assessment

### Genuinely reusable (port/adapt — Julio's own code, no licensing risk)

| Asset | Where it lives | Verdict |
|---|---|---|
| App factory DI pattern (`createApp({db, config})`) | inventory-stock `src/app.ts` | **Copy** — testability without module-level side effects |
| Auth module (register/login/refresh/logout, rotation + reuse detection via `FOR UPDATE SKIP LOCKED`, SHA-256 token hashes, httpOnly signed cookies, identical 401, audit hooks) | inventory-stock `src/modules/auth/*` | **Copy + extend** — production-grade, satisfies code-auditor rules |
| RBAC const registry + per-request DB check (`PERMISSIONS`, `ROLE_PERMISSIONS`, `hasPermission`) | inventory-stock `src/permissions/registry.ts` + middleware | **Copy + extend** — add capstone module permissions (customers, orders, jobs, settings) |
| Error contract (`ApiError`, uniform `{error:{code,message}}`, 401/403/422/409) | inventory-stock `src/middleware/errorHandler.ts` | **Copy** |
| zod v4 DTOs + `validateDto` middleware | inventory-stock `src/middleware/validate.ts` | **Copy** |
| `withTransaction` helper | inventory-stock `src/db/transaction.ts` | **Copy** |
| Idempotent SQL migrations + `migrate.ts` (dev/test DB targeting) | inventory-stock `src/db/sql/*`, `scripts/migrate.ts` | **Copy** |
| Movement ledger: immutable rows, derived stock view, `pg_advisory_xact_lock`, idempotency keys + request hash, negative-stock invariant | inventory-stock `src/modules/movements/*` | **Port/adapt** — stock is a capstone module; orders will consume it |
| Audit module: append-only table + trigger, same-tx writes, best-effort auth audit | inventory-stock `src/modules/audit/*` | **Copy/adapt** — generic schema (action/entity/payload) |
| Test infrastructure: `tests/helpers/{testApp,db,users}.ts`, supertest + node:test, requirement-referenced test names | inventory-stock `backend/tests/` | **Copy pattern** |
| docker-compose Postgres 16 + healthcheck | inventory-stock `docker-compose.yml` | **Copy** |
| Frontend auth plumbing (AuthContext, ProtectedRoute, RoleGate, i18n es/en) | inventory-stock `frontend/src/` | **Port pattern** |

### NOT reusable (assessed)

- **exp-02 mini-ORM** — built on `node:sqlite`; the capstone is PostgreSQL. Rewriting it for pg (transactions, relations, joins) is scope creep on the flagship. Its educational value is complete; the repository pattern already proved superior for this codebase.
- **exp-04 mini-http-framework** — deliberately small (no async auto-wrap, no ecosystem); not appropriate to run the flagship on. Its purpose (understanding Express internals) is served; strategic decision #1396 keeps it standalone.
- **exp-05 storage engine** — WAL/NDJSON is educational; PostgreSQL provides WAL. Not applicable.
- **exp-03 message queue** — idea only; pg-boss covers queue semantics inside PostgreSQL (see jobs comparison). Stays deferred to T6 per #1393.
- **lab-05 caching** — complete but deferred to post-v1 (YAGNI for the minimum serious v1; techniques documented).

## Stack Comparison (fundamentación)

### API framework: Express 5 ✅ vs Fastify vs Hono

| | Express 5 | Fastify | Hono |
|---|---|---|---|
| Pros | Proven in workspace (138 tests); Julio built a clone from scratch (exp-04) → deep internals understanding; #1 in job market demand; supertest integration proven; async errors auto-forwarded in v5 | Schema-first validation/serialization built-in; faster; stronger TS | Modern, edge-ready, excellent TS, lightweight |
| Cons | — | New learning curve; different error model; smaller familiarity payoff | Smaller backend-job-market footprint; needs @hono/node-server; middleware ecosystem smaller |
| Effort | Low | Medium | Medium |

**Recommendation: Express 5.** Grounding: workspace convention + inventory-stock proof + employment-market standard + zero migration risk. The capstone's value is domain depth, not framework novelty. Fastify/Hono add risk without employment payoff at this stage.

### Data access: pg raw + repository ✅ vs mini-ORM vs Drizzle vs Prisma

| | pg raw + repo | mini-ORM (own) | Drizzle | Prisma |
|---|---|---|---|---|
| Pros | Proven; parameterized queries; full SQL control for the interesting parts (ledger SUM views, advisory locks, `FOR UPDATE SKIP LOCKED`) | "Own" story | TS-first, SQL-like, light | Popular, typed, codegen |
| Cons | — | Built on node:sqlite → full pg rewrite = scope creep; no tx/relations by design | New migration system (drizzle-kit) vs proven SQL files; raw SQL still needed for locks | Codegen adds a build step (violates "no build step" convention); heavy; N+1 foot-guns; less control |
| Effort | Low | High | Medium | Medium |

**Recommendation: pg raw + repository pattern.** Grounding: the capstone's differentiating logic lives in SQL (concurrency, immutability, derived state) — an ORM would fight it, not help it. Keeps the proven migrate.ts + idempotent migrations. Employment-wise, raw SQL + a clean repository layer is universally legible.

### Jobs: pg-boss ✅ vs BullMQ vs own queue

| | pg-boss | BullMQ | Own queue |
|---|---|---|---|
| Pros | PostgreSQL-backed (exactly-once via SKIP LOCKED — same primitive already used in inventory-stock); retries with exponential backoff; dead-letter queues; cron; singleton policies; LISTEN/NOTIFY; job flows (dependency chaining → EVENT→RULE→ACTION); v12.30.0 actively maintained (May 2026), 3.9K stars, 0 vulns; Node 22.12+/PG 13+; optional web dashboard | Powerful; Redis-native; very common in big-company stacks | Full control |
| Cons | Less "cool" than BullMQ | Adds Redis → second infra component (memory + persistence + backup on a small VPS) | Reinvents SKIP LOCKED logic pg-boss already nails; scope creep on the flagship |
| Effort | Low | Medium | High |

**Recommendation: pg-boss.** Grounding: one infrastructure component (PostgreSQL) fits the single-VPS production goal; its semantics directly satisfy LAB-06 (queue + workers) and LAB-07 (retry/backoff/dead-letter) as configuration + evidence, not reimplementation. EXP-03 stays deferred.

### Auth: keep jsonwebtoken + bcryptjs pattern ✅ vs sessions vs Lucia/Auth.js

**Recommendation: port the proven pattern** (jsonwebtoken access 15min + refresh rotation with reuse detection + bcryptjs cost 10 + httpOnly signed cookies + per-request RBAC check). It already meets code-auditor rules (jwt.verify with typ check, exp enforced by verify, no secrets logged, parameterized queries). Sessions or Auth.js would discard proven code and add dependencies without employment value.

### Validation: zod v4 ✅ — workspace standard already; keep `validateDto` middleware (422 VALIDATION_ERROR).

### Testing: node:test + supertest ✅ vs vitest
**Recommendation: node:test + supertest.** Workspace convention, strict TDD active, zero new deps, proven at 138 tests. Coverage available via `--experimental-test-coverage` if desired.

### Logging: pino ✅ vs winston vs plain console
**Recommendation: pino** (JSON structured by default, fast, industry standard) with `redact` config (never log secrets — code-auditor) and pino-pretty in dev. Feeds the observability slice; winston is heavier, console is insufficient.

### API docs: @asteasolutions/zod-to-openapi ✅ vs manual OpenAPI
**Recommendation: @asteasolutions/zod-to-openapi v9** (zod v4 support since v8, actively maintained Jul 2026, 2.5M weekly downloads) + serve the generated spec (Swagger UI). Single source of truth from the DTOs — the same schemas that validate also document. New capability vs inventory-stock (which had none) — strengthens the "quality" pillar.

### Observability slice (Developer Operations Platform absorption)
`GET /api/health` (200 + DB ping) + `GET /api/status` (version, uptime, db state) + pino structured request logs. Minimal by design — no Prometheus/Grafana (T3/T5 territory).

## Structure Proposal

```
capstone/                          ← new npm workspaces monorepo (own GitHub repo, like inventory-stock)
├── package.json                   ← workspaces: backend, frontend; root scripts (db:up, migrate, test, typecheck, dev)
├── docker-compose.yml             ← postgres:16-alpine + healthcheck (+ app for prod compose)
├── Dockerfile                     ← multi-stage (build → run, non-root, HEALTHCHECK)
├── .github/workflows/ci.yml       ← test + typecheck + build on push/PR
├── .github/workflows/deploy.yml   ← CD to target (open question: VPS/Render/Railway)
├── backend/
│   ├── package.json               ← express, pg, zod, jsonwebtoken, bcryptjs, cookie-parser, pino, pg-boss, zod-to-openapi, supertest
│   ├── src/
│   │   ├── app.ts                 ← DI factory (ports inventory-stock)
│   │   ├── server.ts              ← API entrypoint
│   │   ├── worker.ts              ← pg-boss workers entrypoint (same package — services are framework-independent)
│   │   ├── config/env.ts          ← zod-validated env (JWT_SECRET ≥32, DATABASE_URL, etc.)
│   │   ├── db/{pool.ts, transaction.ts, sql/NNN_*.up|down.sql}
│   │   ├── middleware/{requireAuth, requirePermission, validate, errorHandler, requestLogger}
│   │   ├── permissions/registry.ts  ← const types, extended with capstone modules
│   │   ├── lib/{decimal, logger(pino)}
│   │   └── modules/
│   │       ├── auth/              ← ported + extended
│   │       ├── crm/               ← customers (CRM-lite)
│   │       ├── orders/            ← orders + lines + status machine
│   │       ├── stock/             ← products, warehouses, movements ledger (ported/adapted)
│   │       ├── jobs/              ← pg-boss queues, job definitions, worker handlers (LAB-06/07)
│   │       ├── notifications/     ← in-app notifications + email action
│   │       ├── audit/             ← ported append-only (LAB-08)
│   │       └── observability/     ← health + status
│   ├── scripts/{migrate.ts, seed.ts}
│   └── tests/{helpers, unit, integration, concurrency}
├── frontend/                      ← React 19 + Vite 6 + react-router 7 (pattern from inventory-stock)
│   └── src/{pages per module, auth/, components/, i18n/}
└── docs/                          ← evidence (output-*.txt per lab methodology), ADRs, architecture
```

Key decisions embedded:
- **Single backend package, two entrypoints** (server.ts + worker.ts) for v1 — pg-boss workers share the same module code directly; no cross-workspace package wiring. A separate `worker` workspace is a post-v1 refactor if ever needed.
- **Vertical-slices flow per iteration** (routes → controller orchestration only → service pure logic → repository → dto → tests), per the injected standards.
- **LAB-06/07/08 integration**: methodologies (hypothesis → experiment → evidence) applied as capstone modules; `docs/output-*.txt` evidence kept in capstone/docs. LAB-08 is already proven in inventory-stock (audit module); LAB-06/07 become pg-boss queue + retry/dead-letter configuration with measured evidence (e.g., worker concurrency, retry backoff behavior).
- **Workflow Engine absorption**: EVENT → RULE → ACTION. v1: domain events (order.confirmed, stock.low) → rules (thresholds; hardcoded per flow, YAGNI) → actions (enqueue notification job). Table-driven rules engine deferred.

## v1 Scope Valoración

**MINIMUM serious v1 (deployable, demoable, employable) — TDD iteration order:**

1. **Foundation + auth/RBAC** — monorepo scaffold, env, db, migrations, auth (register/login/refresh/logout), RBAC, error contract, pino logging, health endpoint, test infra. *Everything depends on this; do first.*
2. **CRM-lite** — customers CRUD + search + status; audit events.
3. **Orders** — orders + lines + status machine + totals; idempotency keys; audit same-tx.
4. **Stock** — products, warehouses, movements ledger, stock views, low-stock; ported from inventory-stock; **order confirmation creates stock movements atomically** (the integration showpiece).
5. **Jobs/notifications** — pg-boss: order.confirmed → notify; low-stock → notify; retry + dead-letter + evidence (LAB-06/07 methodology); worker entrypoint.
6. **Audit + observability + OpenAPI** — audit read API, /api/status, zod-to-openapi spec served, full suite green.
7. **Production** — multi-stage Dockerfile, prod compose, CI (test + typecheck + build), CD (deploy), README + evidence dashboard (dashboard-pages pattern), 2-3 articles, portfolio case study.

**Deferred (post-v1):** PDF generation, webhooks, table-driven rules engine, caching (lab-05), rate limiting (lab-04 pattern), frontend automated tests (strict TDD applies to backend), coverage gate, multi-tenancy, Redis/BullMQ migration.

## Preliminary Requirements (reconnaissance)

**Functional:**
- AUTH: register (admin-only, as inventory-stock), login (identical 401, no enumeration), access 15min Bearer, refresh 7d httpOnly signed cookie + rotation + reuse detection (family invalidation), logout idempotent.
- RBAC: permission codes `{module}:{operation}` seeded in SQL + const registry; per-request DB check; 403 FORBIDDEN; roles: admin/operator/viewer/auditor (extendable — open question).
- CRM: customers CRUD, list/search, active/inactive, audit on every mutation.
- ORDERS: create with lines (product, qty, unit price), status machine with valid transitions, totals in string numerics (D13 pattern), idempotency key (LAB-02), confirmed orders drive stock movements (LAB-01 guarantees).
- STOCK: immutable movement ledger (qty>0, sign ±1), derived stock views, transfers + adjustments with mandatory reason, advisory locks, append-only protection.
- JOBS: pg-boss queues (e.g., `notification.send`), retryLimit/backoff/dead-letter per queue, workers in worker.ts, job audit trail (job id, state, attempts).
- NOTIFICATIONS: in-app table (read/unread) + email action (console sink v1; SMTP open question).
- AUDIT: append-only, same-tx, actor/action/entity/payload JSONB, no credentials ever (AUD-6), read API with filters.
- OBSERVABILITY: /api/health (db ping), /api/status (version/uptime/db), pino structured logs.
- DOCS: OpenAPI 3.1 generated from zod DTOs, served at /api/docs.

**Non-functional / security (code-auditor):** parameterized queries only; `jwt.verify` with typ check (exp enforced); no secrets in logs (pino redact); bcryptjs cost 10; env validated ≥32 chars secrets; CORS restricted; Secure cookies in production; strict tsc --noEmit; node:test + supertest; requirement-referenced test names; multi-stage Dockerfile non-root + HEALTHCHECK; CI on push.

## Risks

- **Scope creep** — the absorption rule is strict (capstone is the ONLY legitimate container). Every "nice idea" (PDF, webhooks, rules engine) must be explicitly deferred.
- **Porting time** — auth/RBAC/audit porting is fast (own code) but must not become blind copying; the design phase should decide what changes (e.g., register permissions, new module permissions).
- **Orders↔stock coupling** is the main integration risk — needs a clear design decision (order confirm → movements in same tx) before spec.
- **pg-boss learning curve** — new dependency for Julio; mitigated by pg-boss being PostgreSQL-native (SKIP LOCKED already understood).
- **Deployment unknowns** — target platform, secrets management, domain/DNS, cost; unresolved, CD design cannot be finalized.
- **Frontend scope** — building React pages for every module doubles the effort; API-first ordering keeps the backend demoable regardless.

## Open Questions (need user input before/at proposal)

1. RBAC roles: keep 4 roles (admin/operator/viewer/auditor) or add sales/manager? Which permissions map to orders/CRM?
2. CRM-lite and orders: full React frontend in v1, or API-first with minimal UI? (inventory-stock proves the frontend pattern; cost is real.)
3. Email action: console sink (v1) or real SMTP (nodemailer)? Demo-impressive vs config burden.
4. Deployment target: Docker Hub + VPS, Render, Railway, or Fly.io? Own domain?
5. Notifications: in-app only, email only, or both in v1?
6. Order→stock coupling: confirm creates out-movements atomically (recommended) — confirm.
7. Registration: admin-only (inventory-stock precedent) — confirm for the capstone.
8. Money representation: string numerics (inventory-stock D13) — confirm.
9. Repo strategy: new GitHub repo for capstone (like inventory-stock) — confirm name/branding.
10. pg-boss vs BullMQ: recommendation is pg-boss (no Redis) — confirm.
11. Low-stock notification trigger: event-driven on movement (recommended) vs cron scan.
12. Multi-tenancy: out of scope (single-company platform) — confirm.

## Ready for Proposal

**Yes.** All stack decisions have grounded recommendations; the structure, iteration order, and requirements are drafted. The proposal phase should lock: (a) the 12 open questions above into explicit decisions, (b) the v1 iteration order, (c) the absorption mapping, and (d) the deployment target.