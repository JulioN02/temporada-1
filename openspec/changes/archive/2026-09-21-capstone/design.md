# Design: CAPSTONE — Business Operations Platform (BOP v1)

Change: `capstone` · Project: `temporada-1` · Phase: **design** · Artifact store: **hybrid**
Date: 2026-09-19 · Upstream: `spec.md` (2026-09-18) · Downstream: tasks
Repo: `business-operations-platform` · STRICT TDD active — every design decision maps to spec scenarios (R-XXX) → `node --test` cases in apply.

## 1. Overview

Technical design for BOP v1: Express 5 + pg raw (repository pattern) + pg-boss v12 + zod v4 + pino, delivered as a self-contained Docker appliance (API + worker + Postgres 16 + minimal UI, offline). Single backend package, two entrypoints (`server.ts`, `worker.ts`). Eight vertical-slice modules (auth, crm, orders, stock, jobs, notifications, audit, observability) over proven primitives ported from inventory-stock. The integration showpiece is the **atomic order-confirm → stock out-movements → notifications → email-job enqueue** transaction (spec §3.1).

This document resolves the 5 flagged spec decisions (ADR-1, ADR-2, ADR-4, ADR-5, ADR-6), defines port-adapt deltas, schema, transactional boundaries, jobs, notifications, observability, OpenAPI, env, and production packaging. Every ADR lists the spec scenarios (R-XXX) that will prove it.

## 2. Technical Approach (rooted in requirements)

- **Monorepo** `capstone/` (npm workspaces: `backend` + `ui`), own GitHub repo `business-operations-platform` (R-PROD-8). Backend runs TS natively (`node src/*.ts`, Node ≥22.12 — inventory-stock pattern, no build step; `erasableSyntaxOnly` per R-NFR-3).
- **Vertical slices per module**: `routes → controller (≤15 lines, orchestration only) → service (pure, framework-independent) → repository (only DB access) → dto (zod) → tests` (R-NFR-4).
- **Events**: domain events raised *inside* their transactions (R-NOT-6): `order.confirmed`, `order.cancelled`, `stock.movement` (→ low-stock rule), `user.created`. Event → hardcoded rule (v1) → action (notification rows + email job enqueue). No polling anywhere (test scans worker entrypoints, R-NOT-6).
- **Exactly-once** via: (a) same-tx pg-boss enqueue through the `db` adapter (ADR-2), (b) `UNIQUE(type, reference, channel)` on notifications, (c) unique idempotency keys per entity.
- **Money**: D13 string numerics — `NUMERIC(13,2)` columns, exact string math in `lib/decimal.ts` (ported), never JS float (R-ORD-2).
- **Delivery**: appliance via multi-stage Docker (non-root + HEALTHCHECK), compose = api + worker + db + ui + mailpit (dev), CI/CD → GHCR, optional Oracle Cloud Always Free runbook (R-PROD-1..4, ADR-10).

## 3. Architecture Decisions (ADRs)

### ADR-1 — UNKNOWN_PRODUCT: 422 (flagged decision 1)
**Choice**: `422 VALIDATION_ERROR` with message `UNKNOWN_PRODUCT: product <id> not found` (R-ORD-1 scenario already asserts 422).
**Alternatives**: 409 CONFLICT — rejected: the 409 subcode list is closed and reserved for *state conflicts* (USERNAME_TAKEN, DUPLICATE_EMAIL, INVALID_STATE, INSUFFICIENT_STOCK, NEGATIVE_STOCK, DUPLICATE_SKU); an unknown product id is not a conflict with the state of an existing resource, it is an unsatisfiable input reference. 404 — rejected: the missing entity is not the request's target resource (the order).
**Rationale**: one consistent rule applied everywhere: **referential validation failures (referenced entity does not exist) → 422 `UNKNOWN_<ENTITY>`; state conflicts (entity exists, operation not allowed in current state) → 409**. Uniformity keeps the ApiError contract one-code-per-status (`VALIDATION_ERROR`, message carries the subcode).
**Tests**: `R-ORD-1 unknown product`; parity: unknown customerId on order create → 422, unknown warehouseId on movement → 422.

### ADR-2 — pg-boss same-tx enqueue: `db` adapter on `send()` (flagged decision 3)
**Choice**: option (a) — `boss.send(queue, data, { db: { executeSql: (sql, values) => tx.query(sql, values) } })` where `tx` is the `withTransaction` client. Verified against pg-boss v12 docs: the `db` option is the supported "Atomic Job Insertion" mechanism; if the surrounding tx rolls back, the job row never becomes visible to workers (exactly-once preserved). No outbox table, no poller — satisfies R-NOT-6's "no cron/setInterval" test.
**Alternatives**: (b) post-commit enqueue + unique key — rejected: crash window between commit and enqueue loses the notification permanently; uniqueness prevents duplicates, not loss. (c) outbox table + poller — rejected: extra table, relay, and a poller that conflicts with R-NOT-6's no-polling test.
**Rationale**: `db` adapter gives true atomicity (job insert participates in the tx) with zero extra infrastructure. Safety net: worker boot runs a one-time reconciliation — notifications with `delivery_state='pending'` + `channel='email'` lacking a job record → re-enqueue (idempotent via UNIQUE(type,reference,channel)); closes theoretical crash-window loss without a poller.
**Tests**: `R-ORD-5 happy path` (job enqueued in same tx), `R-ORD-5 insufficient stock` (zero jobs after rollback — assert `pgboss.job` count unchanged), `R-NOT-6 exactly-once` (replay → 1 row, 1 job).

### ADR-3 — Notification channel matrix as const registry + parity test
**Choice**: `NOTIFICATION_TYPES` const registry in `modules/notifications/types.ts` — one entry per type with `channels: ('in_app'|'email')[]`, `recipients` rule, `template`. Single source of truth for the locked matrix; parity test asserts registry ≡ spec table.
**Alternatives**: hardcoded `if/else` per module — rejected: matrix would drift from behavior; the locked matrix deserves an enforced contract.
**Rationale**: channel decisions are data, not code paths.
**Tests**: `R-NOT-2` all 5 scenarios + matrix parity test + `R-DOC-1` (registry drives OpenAPI enum).

### ADR-4 — Notification recipient targeting (flagged decision 2)
**Choice**: targeting rules as const registry, resolved **inside the originating transaction** (same-tx SELECT of recipients → rollback removes rows):

| Type | Recipients | Resolution |
|---|---|---|
| `order_confirmed`, `order_cancelled` | order creator (`orders.created_by`) | 1 user |
| `low_stock` | active users with role `manager` OR `operator` | role-based query |
| `stock_adjusted`, `stock_transferred` | active `admin` + `manager` | role-based query |
| `user_invited` | the invited user | 1 user (email only) |
| `job_failed` | active `admin` + `manager` | role-based query |

Registry shape: `NOTIFICATION_TARGETS: Record<NotificationType, {channels, recipients: 'order_creator'|'role:manager,operator'|'role:admin,manager'|'invitee'}>`. Recipient query lives in the notifications repository (parameterized SQL), called from the event dispatcher with the tx handle.
**Alternatives**: post-commit resolution in worker — rejected: breaks atomicity (rollback would leave orphan notifications) and re-creates the exactly-once problem. Hardcoded role lists per call-site — rejected: drift risk.
**Rationale**: in-tx resolution keeps the atomic contract (§3.1) whole: all-or-nothing for rows *and* recipients.
**Tests**: `R-NOT-2` scenarios (recipient = order creator); new: `low_stock` recipients (manager+operator get rows, viewer doesn't), `R-AUD-2` rollback parity covers orphan prevention.

### ADR-5 — low_stock event model (flagged decision 4)
**Choice**: the low-stock rule is evaluated at **one choke point** — the shared movement-write path in the stock repository — for *every* movement insert (adjustment, transfer, order_out), because R-STK-7 says "any movement that crosses". Rule: **fire iff `sign = −1` AND new derived level < product.low_stock_threshold** (covers "6→4 fires", "4→3 already-low fires again", "8→6 no fire"; positive movements never fire). Detection happens under the already-held product advisory lock → race-free. Effect (notification rows for manager+operator + email job enqueue) runs **in the same tx** — the main tx is never blocked by anything slower than row inserts; SMTP send is exclusively the worker's job (R-NOT-3).
**Dedupe deferral is cleanly separable**: v1 emission is the simple rule above; post-v1 dedupe only changes the emission *condition* (e.g., "no low_stock row for this product within window W") inside the same choke point — no structural or schema change (reference `low_stock:{movementId}` already yields per-crossing rows).
**Alternatives**: post-commit deferred check job — rejected: violates R-NOT-6 (events raised inside their transactions) and adds a queue + latency + a second exactly-once problem. Cron scan — explicitly rejected by the locked decision (event-driven).
**Tests**: `R-STK-7` all 3 scenarios + `R-NOT-6 no polling` + new: order_out crossing the threshold also fires (extends R-ORD-5 happy path).

### ADR-6 — /api/status exposure: any authenticated user (flagged decision 5)
**Choice**: `GET /api/status` requires any authenticated user (R-OBS-2 locked); returns `{version, uptimeSeconds, db, timestamp}` plus additive `queues: "up"|"down"` (pg-boss ping, bounded 500ms timeout, never blocks the response). `GET /api/health` stays public: pure `SELECT 1` liveness for Docker HEALTHCHECK (R-OBS-1).
**Alternatives**: public status — rejected: version disclosure enables fingerprinting for known-CVE targeting; health already serves anonymous liveness. Admin-only — rejected: readiness/diagnostic value belongs to every authenticated operator incl. viewer/auditor; no internals are exposed (no stack, no secrets, no config).
**Rationale**: clean liveness/readiness split; R-PROD-1 HEALTHCHECK consumes the public endpoint; `queues` gives the dead-worker signal (jobs pile up) without leaking internals.
**Tests**: `R-OBS-2 authed` + `R-OBS-2 unauthenticated → 401`; new: `queues` field present when boss pingable.

### ADR-7 — 5-role RBAC delta (decision #1)
**Choice**: port the inventory-stock auth/RBAC stack (const registry, per-request DB check, identical 401, refresh rotation + reuse detection, SHA-256 hashes, httpOnly signed cookies) and **adapt** it: roles become `admin, manager, operator, viewer, auditor` (adds `manager`); permission codes per the locked matrix (§5 of spec): `auth:user_create|user_read|user_update`, `crm:customer_create|customer_read|customer_update`, `orders:order_create|order_read|order_confirm|order_cancel`, `stock:product_manage|stock_adjust|stock_transfer|stock_read`, `jobs:job_read|job_retry`, `notification:read|notification:update`, `audit:read`. Registry pattern preserved (const objects + mapped union type, never bare string unions).
**Alternatives**: extend inventory-stock's 4 roles — rejected: matrix requires the manager tier. Dynamic per-user permission rows — rejected: YAGNI, role-based matrix is locked and simpler to seed/test.
**Rationale**: the const registry + SQL seed parity test (R-AUTH-7) is the enforcement mechanism; per-request DB check (R-AUTH-8) covers mid-session role changes with no token re-issue.
**Tests**: `R-AUTH-7` seed + parity, `R-AUTH-8` all scenarios, `R-NFR-5` scan.

### ADR-8 — D13 string money (decision #8)
**Choice**: `NUMERIC(13,2)` columns; `lib/decimal.ts` (ported from inventory-stock) with exact string math — `mul(qty, unitPrice)`, `add`, `format` — computed in the service layer (framework-independent, unit-testable); API serializes exactly 2 decimals. `total = Σ qty × unitPrice` via decimal.ts, never JS float; DB recomputes nothing.
**Alternatives**: JS float with rounding — rejected (0.30000000000000004). Numeric in JS (pg returns string for NUMERIC) with Number() math — rejected: precision loss at scale 13,2 boundaries.
**Rationale**: string-typed math keeps exactness end-to-end (R-ORD-2 asserts exact strings); the type is a branded `DecimalString` (`${number}.xx` pattern via zod refine).
**Tests**: `R-ORD-2` all 3 scenarios + `decimal.test.ts` unit tests.

### ADR-9 — Atomic order↔stock contract + cancel-does-not-reverse (decision #6 + R-ORD-6)
**Choice**: one transaction for confirm (see §6 Transactional Boundaries); cancel never auto-reverses movements — recovery is a manual `stock:stock_adjust` (R-ORD-6, locked). The order row lock serializes concurrent confirms of the same order; product advisory locks in ascending id order serialize confirm vs adjust (deadlock-free, §6).
**Alternatives**: cancel auto-reversal — rejected by the locked decision (ledger integrity + audit trail; reversal would mask operator intent). Two-phase (movements first, order later) — rejected: observable partial states violate §3.1.
**Rationale**: single tx = commit-all/rollback-all with zero side effects on failure (R-ORD-5 scenarios); the design reuses inventory-stock's proven primitives (advisory locks, idempotency keys, immutable ledger).
**Tests**: `R-ORD-5` all 7 scenarios + `R-ORD-6` both + `R-AUD-2` rollback parity.

### ADR-10 — Appliance delivery (decision #4, revised)
**Choice**: self-contained appliance — multi-stage Dockerfile (build → runtime, non-root, HEALTHCHECK on `/api/health`); `docker-compose.yml` runs the full stack offline: `api` (serves API + minimal UI at `/`), `worker`, `db` (postgres:16-alpine, volume, pg_isready healthcheck), `migrate` one-shot service (`depends_on: db, condition: service_completed_successfully`), `mailpit` for dev SMTP. CI (push/PR): migrate → tsc --noEmit → node --test → docker build → push `ghcr.io`. CD (tag `v*`): publish + documented Oracle Cloud Always Free runbook (`docs/deploy-oracle.md`). No paid VPS, no Docker Hub requirement.
**Alternatives**: paid VPS + Docker Hub — rejected (user decision #4). Single-container all-in-one — rejected: worker and API need independent restarts/health; separate services from one image is the standard appliance shape.
**Rationale**: offline appliance = demoable anywhere; GHCR = free registry; Oracle Always Free = $0 production path; runbook keeps deployment reproducible (R-PROD-3/4).
**Tests**: `R-PROD-1` non-root + healthcheck, `R-PROD-2` full-stack compose, `R-PROD-3/4` CI/CD, `R-PROD-8` repo + dashboard.

### ADR-11 — pg-boss vs BullMQ (decision #10)
**Choice**: pg-boss v12 (locked). One infra component (PostgreSQL), SKIP LOCKED semantics already proven in inventory-stock, durable across worker restarts (R-JOB-2), built-in retry/backoff/dead-letter (R-JOB-3), cron-free event-driven usage.
**Alternatives**: BullMQ — rejected (decision #10): adds Redis (second infra component: memory, persistence, backup) to the appliance. Own queue — rejected: reinvents SKIP LOCKED; scope creep on the flagship.
**Rationale**: appliance goal favors minimal components; pg-boss satisfies LAB-06/07 as configuration + evidence, not reimplementation (R-JOB-3 evidence).
**Tests**: `R-JOB-1..6` all scenarios.

### ADR-12 — API-First v1 with minimal verification UI (decision #2)
**Choice**: v1 ships the complete API + a lightweight non-React verification UI (static HTML + vanilla JS, served by the API at `/`): login + read views (customers, orders, stock, notifications) + a confirm-order flow proving the atomic path end-to-end (R-PROD-7). Full React app is post-v1.
**Alternatives**: full React frontend in v1 — rejected (locked): doubles effort, delays the backend flagship; inventory-stock already proves the React pattern for later.
**Rationale**: API-first keeps every iteration demoable via curl/supertest; the minimal UI satisfies the "deployable, demoable" success criterion without frontend scope.
**Tests**: `R-PROD-7` end-to-end scenario (UI login → lists render → confirm order → notification appears).

### ADR-13 — SMTP worker-only via thin mailer abstraction
**Choice**: a thin `Mailer` interface (`send({to, subject, text}) → Promise<void>`) with one real implementation using **nodemailer** (new dependency — needed for real SMTP, decision #3) and a test spy. The mailer is injected only into the jobs module (worker context); the request path never imports it (R-NOT-3). Dev/test SMTP sink: mailpit (compose service / env `SMTP_HOST=mailpit`).
**Alternatives**: raw SMTP client by hand — rejected: protocol edge cases (TLS, auth, MX) are not flagship scope; nodemailer is the industry standard. Inline `net.Socket` — same rejection.
**Rationale**: abstraction keeps services framework-independent and the worker-only rule enforceable by import scan; nodemailer handles SMTP details; mailpit gives deterministic dev/test assertions (R-NOT-4).
**Tests**: `R-NOT-3` (mailer spy: 0 sends in request path, 1 enqueued job), `R-NOT-4` (mailpit down → retry → DLQ; up → exactly 1 message), `R-JOB-4` redelivery.

## 4. Port-adapt deltas vs inventory-stock

| Asset | Verdict | Delta |
|---|---|---|
| `app.ts` createApp DI factory | **reuse** | + module registration list, + openapi registry wiring |
| `config/env.ts` | **adapt** | new zod schema: + SMTP_*, APP_VERSION, COOKIE_SECRET (≥32), pg-boss vars; fail-fast no-secret-echo (R-PROD-5) |
| `db/pool.ts`, `db/transaction.ts` (`withTransaction`) | **reuse** | tx client type exported for pg-boss `db` adapter |
| `db/sql/*` + `scripts/migrate.ts` (idempotent) | **adapt** | new migrations 001–006 (§5); migrate.ts gains `--db=test` target (already present) |
| `middleware/errorHandler.ts` (ApiError, uniform body) | **reuse** | 422 message convention `UNKNOWN_<ENTITY>` (ADR-1) |
| `middleware/validate.ts` (validateDto, zod v4) | **reuse** | unchanged |
| `middleware/requireAuth.ts`, `requirePermission.ts` | **reuse** | permission codes from new registry |
| `permissions/registry.ts` | **adapt** | 5 roles (adds manager), 18 permission codes, parity test (ADR-7) |
| `modules/auth/*` (register/login/refresh/logout, rotation + reuse detection, SHA-256 hashes, signed cookies, identical 401) | **adapt** | register → admin-only `POST /api/users` (+ `user_invited` email job); + `/api/users` list/patch (role, active, password); + `/api/auth/me`; audit on login/refresh/logout; no self-registration (R-AUTH-1) |
| `modules/movements/*` (ledger, views, advisory locks, idempotency, negative invariant) | **adapt** | + type `order_out`; low-stock choke point (ADR-5); transfers stay; movement write path returns newLevel to service |
| `modules/audit/*` | **reuse** | generic (action/entity/entity_id/payload); + read API filters/pagination (R-AUD-4) |
| `lib/decimal.ts` | **reuse** | D13 helpers (ADR-8) |
| `tests/helpers/*` (testApp, db, users) | **adapt** | + 5-role user factory, + mailpit helper, + pgboss helper (truncate pgboss tables between tests) |
| `docker-compose.yml` | **adapt** | + api/worker/migrate/mailpit services; postgres:16 stays |
| Frontend auth plumbing | **defer** | post-v1 React; v1 UI is vanilla JS (ADR-12) |
| **new** | `modules/crm/*` | customers vertical slice (R-CRM-1..5) |
| **new** | `modules/orders/*` | orders + lines + status machine + confirm atomic contract (R-ORD-1..7) |
| **new** | `modules/stock/products, warehouses` | products/warehouses CRUD (R-STK-8) |
| **new** | `modules/jobs/*` | pg-boss queues, worker handlers, jobs read API + manual retry (R-JOB-1..6) |
| **new** | `modules/notifications/*` | matrix registry, in-app API, templates, event dispatcher (R-NOT-1..6) |
| **new** | `modules/observability/*` | health + status + pino request logger (R-OBS-1..3) |
| **new** | `src/openapi/registry.ts` | zod-to-openapi generation (R-DOC-1/2) |
| **new** | `src/jobs/worker.ts` + `src/worker.ts` | pg-boss lifecycle + handler registration (R-JOB-2) |
| **new** | `ui/` | minimal verification UI (R-PROD-7) |
| **new** | `.github/workflows/{ci,cd}.yml` | GHCR pipeline (R-PROD-3/4) |
| **new** | `docs/deploy-oracle.md`, `docs/evidence/` | runbook + dashboard-pages evidence (R-PROD-4/6/8) |

## 5. Module Architecture & File Tree

Shared infra lives outside modules: `config/`, `db/`, `lib/`, `middleware/`, `permissions/`, `openapi/`, `jobs/` (queue config + mailer — the worker-side complement of the notifications module). Modules own their slice: `routes → controller → service → repository → dto → tests`.

```
capstone/
├── package.json                    # workspaces: backend, ui
├── docker-compose.yml              # db + migrate + api + worker + mailpit
├── Dockerfile                      # multi-stage, non-root, HEALTHCHECK
├── .env.example                    # all vars, secrets blank
├── .github/workflows/{ci.yml, cd.yml}
├── docs/{deploy-oracle.md, evidence/, output-it1..7.txt}
├── backend/
│   ├── package.json                # + nodemailer, pg-boss, pino, zod-to-openapi, swagger-ui-dist
│   ├── tsconfig.json               # strict: noUncheckedIndexedAccess, exactOptionalPropertyTypes, erasableSyntaxOnly
│   ├── src/
│   │   ├── server.ts               # env → createApp → listen (API entrypoint)
│   │   ├── worker.ts               # boss start → migrate → queues → handlers → onComplete (worker entrypoint)
│   │   ├── app.ts                  # createApp({db, config, boss, mailer}) DI factory
│   │   ├── config/env.ts           # zod env schema (fail-fast, no secret echo)
│   │   ├── db/{pool.ts, transaction.ts, sql/001..006_*.sql}
│   │   ├── lib/{decimal.ts, logger.ts, pgBossTx.ts}   # pgBossTx = db-adapter factory (ADR-2)
│   │   ├── middleware/{errorHandler.ts, requireAuth.ts, requirePermission.ts, validate.ts, requestLogger.ts}
│   │   ├── permissions/registry.ts
│   │   ├── openapi/registry.ts     # OpenAPIRegistry + generateDocument + swagger-ui assets
│   │   ├── jobs/{queues.ts, mailer.ts, templates.ts}  # queue config, Mailer iface + nodemailer impl, render fns
│   │   └── modules/
│   │       ├── auth/{routes, controller, service, repository, dto}.ts
│   │       ├── crm/{routes, controller, service, repository, dto}.ts
│   │       ├── orders/{routes, controller, service, repository, dto}.ts
│   │       ├── stock/{routes, controller, service, repository, dto, events.ts}.ts  # events.ts = low-stock choke point
│   │       ├── notifications/{routes, controller, service, repository, dto, types.ts}.ts
│   │       ├── audit/{routes, controller, service, repository, dto}.ts
│   │       └── observability/{routes, controller}.ts    # health + status (no service/repo beyond db ping)
│   ├── scripts/{migrate.ts, seed.ts}
│   └── tests/
│       ├── helpers/{testApp.ts, db.ts, users.ts, mailpit.ts, pgboss.ts}
│       ├── unit/{decimal.test.ts, permissions.test.ts, templates.test.ts, lowStockRule.test.ts}
│       ├── integration/{auth, users, crm, orders, stock, jobs, notifications, audit, observability, docs}.test.ts
│       └── concurrency/{orderConfirm.test.ts, stockMovements.test.ts}
└── ui/                            # static index.html + app.js (vanilla, served by API at /)
```

Cross-module wiring: the notifications module exposes `emitEvent(tx, {type, reference, payload})` (framework-independent, called by orders/stock/auth services inside their transactions); the jobs module owns `enqueueEmail(tx, notificationRow)` using the pg-boss `db` adapter; audit exposes `writeAudit(tx, entry)`.

## 6. Database Schema (migrations 001–006)

**001_rbac**: `roles(id, code UNIQUE)` seed 5; `permissions(id, code UNIQUE)` seed 18; `user_roles(user_id FK, role_id FK, PK(user_id, role_id))`; `users(id BIGSERIAL PK, username CITEXT UNIQUE, full_name TEXT, email CITEXT UNIQUE, password_hash TEXT, active BOOL DEFAULT TRUE, created_at, updated_at)`.
**002_crm**: `customers(id PK, name TEXT NOT NULL, email CITEXT UNIQUE, phone TEXT, notes TEXT, status TEXT CHECK (status IN ('active','inactive')) DEFAULT 'active', created_at, updated_at)`.
**003_orders**: `orders(id PK, customer_id FK→customers, state TEXT CHECK (state IN ('draft','confirmed','cancelled')) DEFAULT 'draft', total NUMERIC(13,2) NOT NULL, created_by FK→users, confirm_idempotency_key TEXT UNIQUE, confirmed_at, cancelled_at, cancel_reason TEXT, created_at, updated_at)`; `order_items(id PK, order_id FK→orders ON DELETE CASCADE, product_id FK→products, product_name TEXT, product_sku TEXT, quantity INT CHECK (quantity > 0), unit_price NUMERIC(13,2), line_total NUMERIC(13,2))` — name/sku snapshots keep line integrity after product deactivation (R-STK-8). Indexes: `orders(customer_id)`, `orders(state)`, `order_items(order_id)`.
**004_stock**: `products(id PK, name TEXT, sku TEXT UNIQUE, low_stock_threshold INT NOT NULL DEFAULT 0, active BOOL DEFAULT TRUE, created_at, updated_at)` (deactivated, never deleted); `warehouses(id PK, name TEXT UNIQUE, created_at)`; `movements(id PK, product_id FK, warehouse_id FK, type TEXT CHECK (type IN ('adjustment','transfer_out','transfer_in','order_out')), quantity INT CHECK (quantity > 0), sign SMALLINT CHECK (sign IN (-1,1)), reason TEXT NOT NULL, idempotency_key TEXT UNIQUE, created_at)` + **immutability trigger** (block UPDATE/DELETE, R-STK-1); view `stock_levels AS SELECT product_id, warehouse_id, SUM(sign*quantity)::BIGINT AS level FROM movements GROUP BY 1,2` (derived, R-STK-2); index `movements(product_id, created_at DESC)`, `movements(warehouse_id)`.
**005_notifications**: `notifications(id PK, user_id FK→users, type TEXT CHECK (type IN ('order_confirmed','order_cancelled','low_stock','stock_adjusted','stock_transferred','user_invited','job_failed')), channel TEXT CHECK (channel IN ('in_app','email')), title TEXT, body TEXT, reference TEXT NOT NULL, read_at TIMESTAMPTZ, delivery_state TEXT CHECK (delivery_state IN ('pending','sent','failed')) DEFAULT 'pending', created_at, UNIQUE(type, reference, channel))`; indexes `notifications(user_id, read_at)`, `notifications(reference)`. Unique constraint = exactly-once (R-JOB-4, R-NOT-6).
**006_audit**: `audit_log(id PK, action TEXT, entity TEXT, entity_id TEXT, actor_id BIGINT, actor_username TEXT, payload JSONB, created_at)` + **append-only trigger** (R-AUD-1); index `audit_log(created_at DESC)`, `audit_log(entity, action)`.
**pg-boss** tables auto-created by `boss.migrate()` in `pgboss` schema.

Idempotency key formats: order create `{clientKey}` → `orders.idempotency_key` (column, unique); confirm `{clientKey}` → `confirm_idempotency_key`; movements `adjust:{productId}:{uuid}` / `transfer:{from}:{to}:{uuid}` / `order_out:{orderId}:{productId}` → `movements.idempotency_key`. Notification references: `order:{id}`, `low_stock:{movementId}`, `adjust:{movementId}`, `transfer:{movementId}`, `user:{userId}:invite`, `job:{jobId}:failed`.

**Negative-stock invariant enforcement point**: the stock service validates `newLevel ≥ 0` (and transfer source sufficiency) *while holding* the product advisory lock, before insert; the lock is acquired via the repository inside the same tx (`SELECT pg_advisory_xact_lock(product_id)`), and the level is read via `stock_levels` in that tx (R-STK-3/5). This is the single enforcement point for adjustments, transfers, and order_out.

## 7. Transactional Boundaries (order-confirm composition — spec §3.1)

```
withTransaction(async tx => {
  1. lock order row: SELECT ... FROM orders WHERE id=$1 FOR UPDATE        (serialize concurrent confirms)
  2. state check: confirmed → idempotent replay (key match → 200 original) | other key → 409 INVALID_STATE
  3. per line, product ids ASC: pg_advisory_xact_lock(product_id)         (deterministic order, deadlock-free)
     read level (stock_levels); qty > level → throw 409 INSUFFICIENT_STOCK (aborts whole tx)
  4. INSERT movements (type order_out, sign −1, reason 'order <id> confirmed', idempotency_key order_out:{orderId}:{productId})
  5. UPDATE orders SET state='confirmed', confirmed_at, confirm_idempotency_key
  6. writeAudit(tx, 'order.confirm', payload {orderId, lines, total, movementIds})
  7. emitEvent(tx, order_confirmed → rows for order creator + enqueueEmail via pg-boss db adapter (ADR-2))
     low-stock rule evaluated per movement (ADR-5) → low_stock rows + email jobs
  8. commit → 200
})  // any throw → rollback → mapped: 409 INSUFFICIENT_STOCK | 500 INTERNAL_ERROR
```

Failure semantics: insufficient stock → 409, order stays `draft`, ZERO movements/notifications/audit/jobs (all in-tx). Concurrent confirms serialize on the order row lock; loser sees `confirmed` → 409. Concurrent adjust vs confirm serialize on the product lock; negative-stock invariant holds in every interleaving (R-ORD-5 concurrency scenarios + R-STK-5 prove it against real Postgres). The same composition shape (lock → validate → mutate → audit → events) applies to cancel (no movements, R-ORD-6), stock adjustments/transfers, and user create.

## 8. Jobs Architecture (pg-boss)

- **Queues (v1)**: `notification.send` — single queue; `retryLimit: 5` (≥3 per R-JOB-1), `retryBackoff: true` (exponential, base 1s), `retryDelay: 1000`, `expireIn: 15min`. Dead-letter = pg-boss `failed`/`archived` state (inspectable via archive; no separate DLQ table needed).
- **worker.ts lifecycle**: `new PgBoss(connectionString)` → `boss.migrate()` (schema) → `createQueue('notification.send', cfg)` → `boss.work('notification.send', handler)` → `boss.onComplete('notification.send', onCompleteHandler)` (audit `job.completed|job.failed` + create `job_failed` in-app notification on permanent failure — R-JOB-5) → boot reconciliation (ADR-2 safety net) → graceful shutdown on SIGTERM/SIGINT (`boss.stop()` → `pool.end()` → exit 0). Worker never serves HTTP; services are shared directly from the same package (framework-independent — R-NFR-4).
- **Handler `notification.send`** (idempotent, R-JOB-4): load notification by id → if `delivery_state='sent'` skip (redelivery safe) → render template from payload → `mailer.send(...)` → update `delivery_state='sent'`. Throw → pg-boss retries with backoff; exhausted → failed + audit + `job_failed` notification. SMTP failure never touches the domain tx (already committed; R-NOT-4).
- **Job lifecycle audit**: onComplete writes `job.created`/`job.completed`/`job.failed` rows with `{jobId, queue, attempts}` — never payload secrets (R-JOB-5).
- **Jobs read API + retry**: `GET /api/jobs` reads `pgboss.job` ∪ `pgboss.archive` (repository, parameterized; `jobs:job_read`); `POST /api/jobs/:id/retry` → `boss.retry(jobId)` (`jobs:job_retry`, manager+). Manual retry re-queues a dead-lettered job (R-JOB-6).

## 9. Notifications Design

- **Registry** (`modules/notifications/types.ts`): `NOTIFICATION_TYPES` — per type: channels (matrix, ADR-3), recipient rule (ADR-4), template name. `NOTIFICATION_TARGETS` — recipient resolution rules. Templates (`jobs/templates.ts`): pure functions `(payload) => {title, body}` per type; `user_invited` body explicitly never includes the password (R-NOT-5); no secrets by construction.
- **Event dispatcher** `emitEvent(tx, {type, reference, payload})`: resolve recipients (in-tx query, ADR-4) → insert one `notifications` row per recipient per channel (in_app and/or email) → for email channels, `enqueueEmail(tx, row)` via pg-boss `db` adapter (ADR-2). Called by orders (confirm/cancel), stock (movement choke point, ADR-5), auth (user create → `user_invited`, email-only), jobs (onComplete → `job_failed`, in-app only).
- **In-app API** (R-NOT-1): `GET /api/notifications?unreadOnly&page&limit` — caller's rows only (`WHERE user_id = $1`); `POST /api/notifications/:id/read` — `UPDATE ... WHERE id=$1 AND user_id=$2` → 0 rows = 404 (owner scope); idempotent 204 on repeat.
- **Email**: SMTP exclusively in worker (R-NOT-3 — enforced by import structure + mailer spy test); mailpit in dev/test; `delivery_state` pending→sent/failed tracked on the email row (R-NOT-4).

## 10. Observability

- **`GET /api/health`** (public, R-OBS-1): `SELECT 1` with short timeout → 200 `{status:"ok", db:"up"}` | 503 `{status:"degraded", db:"down"}`. Consumed by Docker HEALTHCHECK (R-PROD-1).
- **`GET /api/status`** (any authenticated user, R-OBS-2 + ADR-6): `{version, uptimeSeconds, db:"up"|"down", timestamp, queues:"up"|"down"}` — `queues` from `boss.ping()` bounded 500ms (additive field; locked fields unchanged).
- **pino request logger** (R-OBS-3): one JSON line per request `{method, path, status, durationMs, requestId}` (`requestId` = `crypto.randomUUID()`), `redact: ['req.headers.authorization','req.headers.cookie','password','*.token','smtp*']`, plus `transport` pino-pretty in dev only. **Request bodies are never logged** (secrets excluded by construction — code-auditor). Error lines use pino's `err` serializer; stack traces only at `level: 'error'`.
- **Excluded from logs**: request/response bodies, refresh token values, SMTP credentials, DATABASE_URL, JWT secrets, audit payloads (they live in the DB, not logs).

## 11. OpenAPI (R-DOC)

- `src/openapi/registry.ts`: one `OpenAPIRegistry` built at startup; each module registers its paths + schemas from the **same zod DTOs** that `validateDto` uses (single source of truth, R-DOC-1). `generateDocument` → `openapi.json` served at `/api/docs.json`; Swagger UI at `/api/docs` via bundled `swagger-ui-dist` assets (self-hosted — the appliance must work offline; no CDN).
- Regeneration at startup only; no hand-written OpenAPI file in `src/` (R-DOC-2 — test scans for absence).
- Money fields registered as `string` with pattern `^\d+\.\d{2}$`; notification types as enum from the registry (ADR-3).

## 12. Env / Config (R-PROD-5, R-NFR-2)

`config/env.ts` zod schema — fail-fast at boot; error message names the offending variable **without its value**:

| Var | Required | Notes |
|---|---|---|
| `NODE_ENV` | dev/test/production | |
| `PORT` | default 3000 | |
| `DATABASE_URL` | yes | postgres://… |
| `JWT_SECRET` | yes, ≥32 chars | zod `.min(32)` |
| `COOKIE_SECRET` | yes, ≥32 chars | signed cookies |
| `APP_VERSION` | default 'dev' | injected at Docker build (`--build-arg`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | prod yes / dev via mailpit | `SMTP_HOST=mailpit` in dev compose |
| `PG_BOSS_*` | optional | schema/polling overrides (defaults fine) |

Secrets list: `JWT_SECRET`, `COOKIE_SECRET`, `SMTP_PASS`, `DATABASE_URL`. `.env.example` documents all vars with blank secrets; `docker-compose.yml` wires env from the environment (prod) or defaults (dev with mailpit); CI sets test DB URL + dummy secrets (≥32 chars).

## 13. Production / Infra (R-PROD)

- **Dockerfile** (multi-stage, R-PROD-1): stage 1 `build` — `npm ci` + `tsc --noEmit` (quality gate inside the image build); stage 2 `runtime` — `npm ci --omit=dev`, copy `src/`, `USER node` (non-root), `EXPOSE 3000`, `HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`. Same image runs both `server.ts` (default CMD) and `worker.ts` (compose command override). No build step: Node ≥22.12 native type stripping.
- **docker-compose.yml** (appliance, R-PROD-2): `db` (postgres:16-alpine, named volume, `pg_isready` healthcheck) → `migrate` (one-shot, `depends_on: db: condition: service_healthy`) → `api` + `worker` (same image; `depends_on: migrate: condition: service_completed_successfully`; api ports `3000:3000`) → `mailpit` (dev SMTP sink, UI on `8025`). Full stack offline on localhost.
- **CI** (`.github/workflows/ci.yml`, R-PROD-3): push/PR → setup node 22 → `npm ci` → compose up db → `migrate --db=test` → `tsc --noEmit` → `node --test` → docker build → push `ghcr.io/<owner>/business-operations-platform` (on `main` + `v*` tags).
- **CD** (`.github/workflows/cd.yml`, R-PROD-4): tag `v*` → publish GHCR (already in CI) + optional `workflow_dispatch` deploy step per `docs/deploy-oracle.md` runbook (image pull → `.env` setup → `compose up -d`, Oracle Cloud Always Free VM, $0). No paid VPS, no Docker Hub.
- **Evidence**: `docs/output-it<N>.txt` per iteration (suite results + requirement IDs + demo commands, R-PROD-6); `docs/evidence/` dashboard-pages (static, lists iterations 1–7 with green status + links, R-PROD-8).

## 14. Data Flow (order.confirmed — the showpiece)

```
POST /api/orders/:id/confirm (orders:order_confirm, Idempotency-Key)
  → controller (orchestration) → orders.service.confirm()
  → withTransaction (db/transaction.ts)
       ├─ lock order row (FOR UPDATE)
       ├─ lock products (pg_advisory_xact_lock, id ASC) + sufficiency check
       ├─ movements.insert (order_out, sign −1)         [stock repository]
       │    └─ low-stock choke point → emitEvent(low_stock)  [ADR-5]
       ├─ orders.update (confirmed) + idempotency key
       ├─ audit.write (order.confirm)                   [same tx]
       ├─ notifications.emitEvent(order_confirmed)      [rows in tx]
       │    └─ enqueueEmail → boss.send('notification.send', …, { db: txAdapter })  [ADR-2]
       └─ COMMIT
  → 200 {order, movements}
  → worker.ts: boss.work('notification.send') → templates.render → mailer.send(SMTP)
       → notifications.update delivery_state='sent'      [async, never blocks the API]
```

## 15. File Changes

| File | Action | Grounded In |
|---|---|---|
| `capstone/` monorepo scaffold (package.json, tsconfig, .env.example, compose, Dockerfile, workflows) | Create | R-PROD-1..5 |
| `backend/src/{server,worker,app}.ts`, `config/env.ts`, `db/*`, `lib/*`, `middleware/*`, `permissions/registry.ts`, `openapi/registry.ts` | Create (ported/adapted) | §4 deltas |
| `backend/src/modules/{auth,crm,orders,stock,jobs,notifications,audit,observability}/*` | Create | R-AUTH..R-OBS |
| `backend/scripts/{migrate,seed}.ts`, `backend/tests/**` | Create | Test contract |
| `ui/` minimal verification UI | Create | R-PROD-7 |
| `docs/{output-it*.txt, deploy-oracle.md, evidence/}` | Create | R-PROD-4/6/8 |
| `openspec/…/design.md` (this file) | Create | design phase |

## 16. Testing Strategy (STRICT TDD — RED → GREEN → TRIANGULATE → REFACTOR)

| Layer | What | Approach |
|---|---|---|
| Unit | decimal.ts, permissions registry parity, templates, low-stock rule, status machine transitions | node:test, pure functions, no DB |
| Integration | every endpoint per module; auth flows; error contract; pagination; idempotency replays; audit same-tx; notifications matrix; jobs lifecycle (mailpit); OpenAPI served | supertest vs real Postgres 16 (compose), requirement-prefixed test names (`R-AUTH-2: …`) |
| Concurrency | R-ORD-5 concurrent confirms + adjust-vs-confirm; R-STK-5 parallel adjustments/negatives | real Postgres, Promise.all, assert final state + invariant |
| Contract | R-NOT-2 matrix parity, R-AUTH-7 seed parity, R-NFR-4 module scan, R-NFR-5 verify discipline scan, R-NOT-6 no-polling scan, R-DOC-2 no hand-written OpenAPI, R-NFR-2 secret-literal scan | source scans + registry assertions |
| Evidence | per iteration: `docs/output-it<N>.txt` (counts + requirement IDs) | scripted suite run + appended summary |

Iteration→suite mapping: it1 auth/RBAC+foundation (R-AUTH, R-NFR, health) · it2 crm (R-CRM) · it3 orders (R-ORD) · it4 stock (R-STK, atomic R-ORD-5) · it5 jobs/notifications (R-JOB, R-NOT) · it6 audit/observability/docs (R-AUD, R-OBS, R-DOC) · it7 production (R-PROD) — cumulative suite green each iteration (R-PROD-6).

## 17. Migration / Rollout

Additive, idempotent SQL migrations via ported `migrate.ts` (`001..006`); pg-boss schema auto-migrated by the worker. No data backfill needed (greenfield). Rollback = PR revert per iteration; prod keeps previous Docker tag + DB backup before first deploy (proposal rollback plan). Order of operations for compose: db healthy → migrate → api+worker.

## 18. Open Questions

- [ ] `APP_VERSION` injection point confirmed in CI (build-arg) — trivial, no design impact.
- [ ] Oracle Cloud runbook SMTP provider choice (mailpit-style relay vs provider creds) — documented at it7, env-driven, no code impact.
- [ ] pino-pretty dev transport: workspace convention check — if avoided, plain JSON in dev is fine (no impact on redact contract).

