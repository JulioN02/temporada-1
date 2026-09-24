# Specification: CAPSTONE — Business Operations Platform

Change: `capstone` · Project: `temporada-1` · Phase: **spec** · Artifact store: **hybrid**
Date: 2026-09-18 · Upstream: `proposal.md` (2026-09-18) · Downstream: design
Repo: `business-operations-platform` (user decision #9, RESOLVED) · New spec — `openspec/specs/` does not exist; this is the full v1 contract.

## Purpose

Define the complete, testable contract for the Business Operations Platform v1: auth/RBAC, CRM-lite, orders, stock ledger, jobs, notifications, audit, observability, OpenAPI, and production packaging. Every functional requirement carries a verifiable scenario (Given/When/Then) that maps 1:1 to a requirement-referenced test (e.g. `R-AUTH-2`) in the apply phase (STRICT TDD: RED → GREEN → TRIANGULATE → REFACTOR, evidence in `docs/output-*.txt`).

## Scope

**In (7 TDD iterations):** 1 foundation+auth/RBAC → 2 CRM-lite → 3 orders → 4 stock (atomic coupling) → 5 jobs/notifications → 6 audit+observability+OpenAPI → 7 production. Single backend package, two entrypoints (`server.ts`, `worker.ts`). Stack (locked): Express 5 · pg raw + repository · pg-boss v12 · jsonwebtoken + bcryptjs · zod v4 · node:test + supertest · pino (redact) · @asteasolutions/zod-to-openapi v9 · PostgreSQL 16 · Docker multi-stage non-root + HEALTHCHECK · CI/CD → GitHub Container Registry (free) · optional deploy → Oracle Cloud Always Free ($0).

**Out of scope (explicit, locked):** multi-tenancy, caching, rate limiting, PDFs, webhooks, rules engine, full React frontend in v1 (API-first + MINIMAL verification UI only), frontend tests, coverage gate, Redis/BullMQ, exp-02/04/05 reuse, stock reversal on order cancel (see R-ORD-6), password reset flow (see R-AUTH-1).

---

# 1. Auth & RBAC (R-AUTH)

### Requirement: R-AUTH-1 — Admin-only user registration

Only users holding `auth:user_create` (admin role) MAY create users. There MUST be no self-registration endpoint. The creator sets an initial password; the system SHALL emit a `user_invited` notification (email only — see matrix). Password reset flow is out of scope; initial credentials are communicated out-of-band.

- **Scenario: admin creates user** — GIVEN admin token WHEN `POST /api/users` with `{username, fullName, email, role, password}` THEN 201 AND user exists AND a `user_invited` email job is enqueued.
- **Scenario: non-admin rejected** — GIVEN operator token WHEN same request THEN 403 `FORBIDDEN`.
- **Scenario: duplicate username** — GIVEN existing username WHEN create THEN 409 `USERNAME_TAKEN`.
- **Scenario: invalid role** — WHEN `role: "superuser"` THEN 422 `VALIDATION_ERROR`.

### Requirement: R-AUTH-2 — Login with identical 401 (no enumeration)

`POST /api/auth/login` with valid credentials returns `{user, accessToken}` and sets the refresh cookie. Unknown username and wrong password MUST both return 401 with a byte-identical body `{error:{code:"UNAUTHORIZED",...}}`. The server SHOULD run a dummy bcrypt compare when the user is not found (timing parity).

- **Scenario: success** — GIVEN active user WHEN login with correct password THEN 200 + accessToken + refresh cookie.
- **Scenario: unknown username** — WHEN login with `nobody` THEN 401 identical to wrong-password body.
- **Scenario: wrong password** — WHEN login with valid username + wrong password THEN 401 identical body.
- **Scenario: inactive user** — GIVEN user deactivated by admin WHEN login THEN 401 (same body).

### Requirement: R-AUTH-3 — Access token: 15 min, exp enforced

Access tokens MUST be JWTs with `exp` = 15 minutes, verified with `jwt.verify` (never `jwt.decode` alone), including typ check. Expired tokens MUST yield 401 `UNAUTHORIZED`.

- **Scenario: expired token** — GIVEN token with `exp` in the past WHEN request with `Authorization: Bearer <t>` THEN 401.
- **Scenario: wrong typ** — GIVEN token with `typ: "refresh"` used as access THEN 401.
- **Scenario: valid token** — GIVEN unexpired token THEN request passes auth middleware.

### Requirement: R-AUTH-4 — Refresh rotation + reuse detection

Refresh tokens: 7-day lifetime, SHA-256 hashed at rest, delivered via httpOnly signed cookie (Secure in production). Every refresh MUST rotate: new access + new refresh; the presented refresh becomes invalid. Reuse of an already-rotated refresh token MUST invalidate the whole token family (all sessions of that user).

- **Scenario: normal rotation** — GIVEN login THEN `POST /api/auth/refresh` with cookie#1 → 200 + cookie#2 + access; refresh with cookie#1 again → 401.
- **Scenario: reuse detection** — GIVEN cookies #1 and #2 (attacker replayed #1) WHEN refresh with #1 after #2 was issued THEN 401 AND refresh with #2 also 401 (family invalidated).
- **Scenario: refresh for deactivated user** — GIVEN user deactivated THEN refresh → 401.

### Requirement: R-AUTH-5 — Idempotent logout

`POST /api/auth/logout` MUST invalidate the presented refresh and return 204; repeated logout MUST also return 204.

- **Scenario: logout then refresh** — GIVEN login WHEN logout THEN 204 AND refresh with old cookie → 401.
- **Scenario: double logout** — WHEN logout twice THEN 204 both times.

### Requirement: R-AUTH-6 — Password policy + bcrypt cost 10

Passwords MUST be 12–128 chars with ≥1 letter and ≥1 digit; stored as bcrypt hashes with cost 10. Weak passwords MUST be rejected at validation (422).

- **Scenario: weak password** — WHEN password `abc` THEN 422.
- **Scenario: stored hash** — GIVEN created user THEN `SELECT password_hash` returns a bcrypt string starting `$2b$10$` and never the plaintext.
- **Scenario: policy boundary** — WHEN password of exactly 12 chars with letter+digit THEN accepted.

### Requirement: R-AUTH-7 — Role/permission seed + registry parity

Migrations MUST seed exactly five roles — `admin`, `manager`, `operator`, `viewer`, `auditor` — and all `{module}:{operation}` permissions from the matrix (§5). The TypeScript const registry (`PERMISSIONS`, `ROLE_PERMISSIONS`) MUST be tested for parity with the SQL seeds.

- **Scenario: seed** — GIVEN fresh DB migrated THEN roles table contains the 5 roles.
- **Scenario: parity** — GIVEN registry THEN a test asserts registry ⊆ seeds and seeds ⊆ registry.

### Requirement: R-AUTH-8 — Per-request permission check → 403

Every protected endpoint MUST check the caller's role against the permission matrix via the DB (not only the token) on each request; missing permission yields 403 `FORBIDDEN`.

- **Scenario: forbidden** — GIVEN viewer token WHEN `POST /api/customers` THEN 403.
- **Scenario: allowed** — GIVEN operator token WHEN `POST /api/customers` THEN 201.
- **Scenario: role changed mid-session** — GIVEN admin demotes a user to viewer THEN the user's next request to a non-viewer endpoint → 403 (no token re-issue needed).

---

# 2. CRM (R-CRM)

### Requirement: R-CRM-1 — Create customer

`POST /api/customers` `{name (req), email?, phone?, notes?}` requires `crm:customer_create`. Duplicate email MUST be rejected (409). Email format validated.

- **Scenario: create** — GIVEN operator WHEN valid body THEN 201 + customer with `status: "active"`.
- **Scenario: duplicate email** — WHEN email already used THEN 409 `DUPLICATE_EMAIL`.
- **Scenario: invalid email** — WHEN `email: "x"` THEN 422.

### Requirement: R-CRM-2 — List, search, paginate

`GET /api/customers?q=&status=&page=&limit=` requires `crm:customer_read`; `q` matches name/email case-insensitively (substring); response `{data, pagination:{page,limit,total,totalPages}}`.

- **Scenario: search** — GIVEN customers "Ana Ruiz" and "Luis Paz" WHEN `?q=ana` THEN only Ana.
- **Scenario: pagination** — GIVEN 25 customers WHEN `?page=2&limit=10` THEN 10 rows, `total:25`, `totalPages:3`.
- **Scenario: status filter** — WHEN `?status=inactive` THEN only inactive.

### Requirement: R-CRM-3 — Update customer

`PATCH /api/customers/:id` requires `crm:customer_update`; unknown id → 404; duplicate email on update → 409.

- **Scenario: update** — GIVEN customer WHEN PATCH `{phone}` THEN 200 + updated fields only.
- **Scenario: unknown id** — WHEN PATCH `id=9999` THEN 404.

### Requirement: R-CRM-4 — Status lifecycle

`status` ∈ `active | inactive`, changed via PATCH. Inactive customers MUST be excluded from the default list (no `status` filter) but retrievable by id.

- **Scenario: deactivate** — WHEN PATCH `{status:"inactive"}` THEN list without filter excludes the customer AND `GET /:id` still returns it with `status:"inactive"`.
- **Scenario: invalid status** — WHEN `{status:"frozen"}` THEN 422.

### Requirement: R-CRM-5 — Audit trail on mutations

Every customer create/update/status change MUST write an append-only audit row in the SAME transaction (actor, entity `customer`, entity_id, payload without credentials).

- **Scenario: audit on create** — GIVEN created customer THEN audit table has 1 row `action:"customer.create"` with the customer id.
- **Scenario: audit on rollback** — GIVEN a create that fails on duplicate email (conflict after insert attempt) THEN no audit row for it.

---

# 3. Orders (R-ORD) — incl. atomic contract (decision a)

### Requirement: R-ORD-1 — Create order with lines

`POST /api/orders` `{customerId, lines:[{productId, qty, unitPrice}]}` requires `orders:order_create`. Order MUST have ≥1 line; each line validates product exists, `qty` integer ≥1, `unitPrice` D13 string. Initial state `draft`.

- **Scenario: create** — GIVEN valid customer + product WHEN 2-line order THEN 201 + `state:"draft"` + lines persisted.
- **Scenario: empty lines** — WHEN `lines:[]` THEN 422.
- **Scenario: unknown product** — WHEN line references product 9999 THEN 422 `UNKNOWN_PRODUCT` (design confirms 422 vs 409).

### Requirement: R-ORD-2 — D13 string money, exact totals

All money fields MUST be NUMERIC(13,2) in DB, serialized as strings with exactly 2 decimals. `total = Σ qty × unitPrice` computed in SQL/string math, never JS float. Tests MUST assert exact strings.

- **Scenario: exact arithmetic** — GIVEN line `{qty:3, unitPrice:"0.10"}` THEN `total:"0.30"` (never `0.30000000000000004`).
- **Scenario: serialization** — GIVEN total 12.5 THEN API returns `"12.50"`.
- **Scenario: precision** — WHEN `unitPrice:"0.001"` THEN 422 (scale >2).

### Requirement: R-ORD-3 — Status machine

States: `draft → confirmed`, `draft → cancelled`, `confirmed → cancelled`. Any other transition MUST yield 409 `INVALID_STATE`. `cancel` requires `reason` ≥10 chars.

- **Scenario: valid flow** — GIVEN draft order WHEN confirm THEN `confirmed`; WHEN cancel THEN `cancelled`.
- **Scenario: invalid transition** — GIVEN confirmed order WHEN confirm again THEN 409.
- **Scenario: cancel without reason** — WHEN cancel with reason "x" THEN 422.

### Requirement: R-ORD-4 — Idempotent create

`POST /api/orders` accepts `Idempotency-Key` header. Replay with the same key MUST NOT create a second order; it returns the existing order (200) with the same id.

- **Scenario: replay** — GIVEN created order with key K WHEN POST same body + key K THEN 200 + same order id AND exactly 1 order row.
- **Scenario: different keys** — WHEN same body with keys K1, K2 THEN 2 orders.

### Requirement: R-ORD-5 — Confirm creates stock out-movements ATOMICALLY (decision a — contract in §3.1)

Confirm MUST, in ONE transaction: (1) transition order to `confirmed`; (2) for each line, validate available stock under advisory lock and insert an immutable out-movement (sign −1); (3) write audit rows; (4) create in-app `order_confirmed` notifications + enqueue their email jobs (exactly-once). Commit-all or rollback-all. Insufficient stock → 409 `INSUFFICIENT_STOCK`, order stays `draft`, ZERO movements, ZERO notifications, ZERO audit rows.

- **Scenario: happy path** — GIVEN order with 2 lines, stock sufficient WHEN confirm THEN 200 AND order `confirmed` AND 2 movements (sign −1, one per line) AND 1 audit row `order.confirm` AND notification rows exist AND email jobs enqueued.
- **Scenario: insufficient stock** — GIVEN line qty > available WHEN confirm THEN 409 AND order still `draft` AND movements table unchanged AND notifications table unchanged.
- **Scenario: partial sufficiency** — GIVEN line1 ok, line2 insufficient THEN 409 AND NO movement for line1 either (all-or-nothing).
- **Scenario: movement insert fails** — GIVEN forced DB error on movement insert WHEN confirm THEN 500 AND order still `draft` (rollback verified).
- **Scenario: idempotent replay** — GIVEN confirmed order with key K WHEN confirm again with key K THEN 200 original result AND no duplicate movements; with key K2 → 409 `INVALID_STATE`.
- **Scenario: concurrent confirms** — GIVEN 2 parallel confirms (different keys) THEN exactly one succeeds, other → 409; exactly 1 set of movements.
- **Scenario: concurrent adjust vs confirm** — GIVEN adjustment in flight on the same product THEN confirm serializes via product lock; invariant holds (no negative stock, no lost update).

### Requirement: R-ORD-6 — Cancel does NOT reverse stock

Cancelling a confirmed order MUST NOT auto-insert reversal movements (ledger integrity; audit trail preserved). Recovery is a manual `stock:stock_adjust` with reason. Cancel emits `order_cancelled` notifications (in-app + email).

- **Scenario: no reversal** — GIVEN confirmed order with movements WHEN cancel THEN movements table unchanged AND order `cancelled` AND `order_cancelled` notifications exist.
- **Scenario: audit** — GIVEN cancel THEN audit row `order.cancel` with reason in payload.

### Requirement: R-ORD-7 — Order read APIs

`GET /api/orders` (filters `status`, `customerId`, pagination) and `GET /api/orders/:id` (includes lines) require `orders:order_read`. Detail MUST load order + lines in ≤2 queries (no N+1).

- **Scenario: list filter** — GIVEN 3 orders (2 confirmed) WHEN `?status=confirmed` THEN 2.
- **Scenario: detail** — GIVEN order id WHEN GET THEN 200 + `lines[]` with product info + `total` string.
- **Scenario: unknown id** — THEN 404.

---

# 4. Stock (R-STK)

### Requirement: R-STK-1 — Immutable movement ledger

Movements table: `(id, product_id, warehouse_id, type, quantity>0, sign ±1, reason, idempotency_key UNIQUE, created_at)`. DB trigger MUST block UPDATE/DELETE on movement rows (append-only).

- **Scenario: immutable** — GIVEN movement WHEN `UPDATE` or `DELETE` directly THEN error (trigger).
- **Scenario: valid insert** — GIVEN `{qty:5, sign:-1, reason:"..."}` THEN row inserted.

### Requirement: R-STK-2 — Derived stock views

Stock level MUST be derived (`SUM(sign*quantity)` per product/warehouse) via a view, never a stored counter. View MUST reflect every movement immediately.

- **Scenario: view reflects movement** — GIVEN level 10 THEN adjustment +3 → view shows 13.
- **Scenario: cross-warehouse** — GIVEN warehouses A/B THEN view shows per-warehouse levels.

### Requirement: R-STK-3 — Adjustments with reason + negative-stock invariant

`POST /api/stock/movements` `{type:"adjustment", productId, warehouseId, quantity, reason, Idempotency-Key}` requires `stock:stock_adjust`. Reason mandatory (≥10 chars). Resulting level MUST never be negative (invariant enforced inside the product advisory lock).

- **Scenario: adjust up** — GIVEN level 10 WHEN quantity 5 THEN 201 AND level 15.
- **Scenario: adjust below zero** — GIVEN level 3 WHEN quantity −5 THEN 409 `NEGATIVE_STOCK` AND level still 3.
- **Scenario: missing reason** — WHEN `reason:"x"` THEN 422.

### Requirement: R-STK-4 — Transfers

`POST /api/stock/transfers` `{productId, fromWarehouseId, toWarehouseId, quantity, reason, Idempotency-Key}` requires `stock:stock_transfer`. Transfer = 2 ledger rows (out −, in +) in ONE transaction; `from ≠ to`; source sufficiency enforced.

- **Scenario: transfer** — GIVEN A=10, B=0 WHEN transfer 4 A→B THEN A=6, B=4 AND 2 rows.
- **Scenario: same warehouse** — WHEN from=to THEN 422.
- **Scenario: insufficient source** — GIVEN A=2 WHEN transfer 5 THEN 409.

### Requirement: R-STK-5 — Concurrency safety (advisory locks)

Movements/transfers affecting the same product MUST serialize via `pg_advisory_xact_lock(product_id)`; locks acquired in deterministic order (sorted product ids) to avoid deadlocks. Concurrent operations MUST produce the same result as sequential execution.

- **Scenario: parallel adjustments** — GIVEN level 10 WHEN 2 concurrent +5 adjustments THEN final level 20 (no lost update).
- **Scenario: concurrent negative** — GIVEN level 5 WHEN concurrent −3 and −3 THEN one succeeds, one → 409 `NEGATIVE_STOCK`, final ≥0.

### Requirement: R-STK-6 — Idempotency keys

Same `Idempotency-Key` for the same product → replay returns the original result, no duplicate movement (UNIQUE constraint).

- **Scenario: replay** — GIVEN adjustment with key K THEN repeat with K → same movement id, 1 row total.

### Requirement: R-STK-7 — Low-stock event (EVENT-DRIVEN, no cron — locked)

Any movement that crosses a product's `lowStockThreshold` from ≥ to < MUST emit a `stock.low` event → create `low_stock` notifications (in-app + email — see matrix) and enqueue email jobs. Movements NOT crossing the threshold MUST NOT emit. No scheduled scan exists.

- **Scenario: crossing** — GIVEN threshold 5, level 6 WHEN −2 THEN level 4 → `low_stock` notification created + email job enqueued.
- **Scenario: not crossing** — GIVEN level 8 WHEN −2 (level 6 ≥ 5) THEN no low_stock notification.
- **Scenario: already low** — GIVEN level 4 WHEN −1 THEN level 3 < 5 → notification created again (each crossing movement notifies; dedupe is post-v1).

### Requirement: R-STK-8 — Products & warehouses, stock read

`POST /api/products` `{name, sku, lowStockThreshold}` (unique sku) and `POST /api/warehouses` `{name}` require `stock:product_manage`. Products are deactivated, never hard-deleted (order-line integrity). `GET /api/stock?productId=&warehouseId=` and `GET /api/stock/movements` require `stock:stock_read`.

- **Scenario: create product** — GIVEN manager WHEN POST THEN 201; duplicate sku → 409.
- **Scenario: deactivate product** — WHEN deactivate THEN orders referencing it still resolve (line keeps snapshot name/price).
- **Scenario: movement history** — GIVEN movements THEN `GET /api/stock/movements` returns them newest-first, paginated.

---

# 5. Jobs (R-JOB)

### Requirement: R-JOB-1 — Queue definitions

pg-boss MUST define v1 queues (minimum: `notification.send`) with `retryLimit` (≥3), exponential backoff, and dead-letter policy (jobs exhaust retries → failed/archived state, inspectable).

- **Scenario: queue exists** — GIVEN migrated DB WHEN worker starts THEN `pgboss.getQueue` returns configured queues with retryLimit.
- **Scenario: enqueue** — GIVEN an event WHEN `send` called THEN row appears in pg-boss archive/pending tables.

### Requirement: R-JOB-2 — Worker entrypoint processes jobs

`worker.ts` MUST subscribe handlers and execute jobs; successful execution → job state `completed` + side effect applied (notification row, email send).

- **Scenario: completes** — GIVEN enqueued `notification.send` job THEN worker processes it AND job completed AND notification marked `sent`.
- **Scenario: worker restart** — GIVEN pending jobs THEN worker restart picks them up (durable queue).

### Requirement: R-JOB-3 — Retry, backoff, dead-letter

A handler that throws MUST be retried up to `retryLimit` with backoff, then dead-lettered (state failed/archived with attempt count). Evidence captured per LAB-06/07.

- **Scenario: transient failure** — GIVEN handler fails twice then succeeds THEN job completed with attempts=3.
- **Scenario: permanent failure** — GIVEN handler always throws THEN after retryLimit job is dead-lettered (failed) AND audit rows record each attempt.

### Requirement: R-JOB-4 — Idempotent handlers

Handlers MUST be idempotent: duplicate delivery of the same job MUST NOT duplicate side effects (e.g., email sent once, one notification row — enforced by unique constraint on notification `(type, reference)`).

- **Scenario: redelivery** — GIVEN a job delivered twice (same job id) THEN exactly 1 notification row AND 1 email send (assert via mailpit count).

### Requirement: R-JOB-5 — Job lifecycle audit

Job created/completed/failed MUST write audit rows `{action:"job.created|job.completed|job.failed", entity:"job", payload:{jobId, queue, attempts}}` — never job payload secrets.

- **Scenario: lifecycle trail** — GIVEN job runs to failure THEN audit contains created + failed rows with attempts.

### Requirement: R-JOB-6 — Jobs read API + manual retry

`GET /api/jobs?state=&queue=&page=&limit=` requires `jobs:job_read` (manager/admin). `POST /api/jobs/:id/retry` requires `jobs:job_retry` and MUST move a dead-lettered job back to active.

- **Scenario: list** — GIVEN completed + failed jobs THEN filter `?state=failed` returns only failed.
- **Scenario: manual retry** — GIVEN dead-lettered job WHEN retry THEN job becomes active again AND processed.

---

# 6. Notifications (R-NOT) — incl. channel matrix (decision b)

### Requirement: R-NOT-1 — In-app notifications (read/unread, owner-scoped)

Notifications table: `(id, user_id, type, channel, title, body, reference, read_at, created_at)`. `GET /api/notifications?unreadOnly=&page=&limit=` returns ONLY the caller's rows; `POST /api/notifications/:id/read` marks own row read (204); reading another user's row → 404.

- **Scenario: unread list** — GIVEN 3 notifications (1 read) WHEN `?unreadOnly=true` THEN 2.
- **Scenario: mark read** — WHEN POST read THEN `read_at` set; second call → 204 (idempotent).
- **Scenario: owner scope** — GIVEN user A's notification WHEN user B GETs it THEN 404.

### Requirement: R-NOT-2 — Channel-per-type matrix (decision b — contract in §6.1)

Each notification type MUST declare its channels in a const registry; the matrix below is authoritative and MUST be enforced and tested:

| Type | Trigger | In-app | Email |
|---|---|---|---|
| `order_confirmed` | order.confirm committed | ✅ | ✅ |
| `order_cancelled` | order.cancel committed | ✅ | ✅ |
| `low_stock` | movement crossing threshold | ✅ | ✅ |
| `stock_adjusted` | adjustment committed | ✅ | — |
| `stock_transferred` | transfer committed | ✅ | — |
| `user_invited` | admin creates user | — | ✅ |
| `job_failed` | job dead-lettered | ✅ | — |

- **Scenario: both channels** — GIVEN order confirmed THEN in-app row (recipient = order creator) AND email job enqueued.
- **Scenario: email only** — GIVEN admin creates user THEN no in-app row AND email job enqueued.
- **Scenario: in-app only** — GIVEN adjustment committed THEN in-app row AND no email job.
- **Scenario: matrix parity** — GIVEN registry THEN a test asserts the table above exactly.

### Requirement: R-NOT-3 — SMTP via worker only

Email MUST be sent exclusively by the worker consuming `notification.send`; the request path MUST never call the mailer. SMTP credentials MUST come from env only and MUST be redacted from all logs.

- **Scenario: no send in request** — GIVEN confirm order (200) THEN mailer spy records 0 sends during the request AND 1 enqueued job.
- **Scenario: creds not logged** — GIVEN pino logs THEN no `SMTP_`/`PASSWORD` value present (redact paths tested).

### Requirement: R-NOT-4 — SMTP failure semantics

SMTP failure (connect/auth/send) MUST NOT affect the domain transaction (already committed before the worker runs). The job MUST retry with backoff (R-JOB-3), then dead-letter; notification row SHALL track delivery state (`pending|sent|failed`). Dev/test use mailpit as SMTP sink.

- **Scenario: smtp down** — GIVEN mailpit stopped WHEN email job runs THEN job retries then dead-letters AND in-app row still exists AND its delivery state reflects failure.
- **Scenario: smtp up** — GIVEN mailpit running THEN job completes AND mailpit received exactly 1 message with correct recipient.

### Requirement: R-NOT-5 — Templates per type

Each type MUST have a text template rendering `title` + `body` from its payload; email body MUST NOT contain secrets (tokens, passwords).

- **Scenario: order_confirmed template** — GIVEN confirm event THEN email contains order id + total string.
- **Scenario: no secrets** — GIVEN any template THEN rendered body excludes credentials by construction (asserted for `user_invited`: no password value).

### Requirement: R-NOT-6 — Event-driven triggers

`order_confirmed` and `stock.low` MUST originate from domain events raised inside their transactions (R-ORD-5, R-STK-7) — no polling. Event → rule (hardcoded v1) → action (enqueue). Exactly-once per event (unique `(type, reference)`).

- **Scenario: no polling** — GIVEN no cron/setInterval in codebase (test scans worker entrypoints) THEN notifications still created via events only.
- **Scenario: exactly-once** — GIVEN confirm event processed twice THEN 1 notification row.

---

# 7. Audit (R-AUD)

### Requirement: R-AUD-1 — Append-only

Audit table MUST be append-only: trigger blocks UPDATE/DELETE; only INSERT allowed.

- **Scenario: blocked** — GIVEN audit row WHEN direct UPDATE/DELETE THEN error.

### Requirement: R-AUD-2 — Same-transaction writes

Audit rows MUST be written in the same DB transaction as the business mutation; rollback of the business tx MUST roll back the audit row.

- **Scenario: rollback parity** — GIVEN failed confirm (R-ORD-5) THEN no `order.confirm` audit row exists.

### Requirement: R-AUD-3 — No credentials ever

Audit payloads MUST never contain passwords, token values, refresh hashes, or SMTP secrets (code-auditor rule). Test asserts `auth.login`/`auth.refresh` payloads contain none of these fields.

- **Scenario: login audit** — GIVEN successful login THEN audit row `auth.login` payload has actor/ip only, no password/hash/token fields.

### Requirement: R-AUD-4 — Audit read API

`GET /api/audit?entity=&action=&from=&to=&page=&limit=` requires `audit:read` (admin/auditor); newest-first, paginated.

- **Scenario: filter** — GIVEN audit rows THEN `?entity=customer&action=customer.create` returns only matches.
- **Scenario: permission** — GIVEN operator token THEN 403.

---

# 8. Observability (R-OBS) & API docs (R-DOC)

### Requirement: R-OBS-1 — Health endpoint (public)

`GET /api/health` MUST be unauthenticated, perform a DB ping (`SELECT 1`), return 200 `{status:"ok", db:"up"}` when reachable, 503 `{status:"degraded", db:"down"}` otherwise. Used by Docker HEALTHCHECK.

- **Scenario: db up** — GIVEN healthy DB THEN 200.
- **Scenario: db down** — GIVEN stopped Postgres THEN 503 (not a crash).

### Requirement: R-OBS-2 — Status endpoint

`GET /api/status` requires any authenticated user; returns `{version, uptimeSeconds, db:"up|down", timestamp}`.

- **Scenario: authed** — GIVEN valid token THEN 200 with all fields; unauthenticated → 401.

### Requirement: R-OBS-3 — Structured request logs with redact

Every request MUST produce one pino JSON log line (method, path, status, durationMs, requestId) with `redact` paths for `authorization`, `cookie`, `password`, `*.token`, SMTP secrets. Logs MUST be parseable JSON.

- **Scenario: log line** — GIVEN a request THEN log line exists with status + durationMs AND no token/password values anywhere (redact tested).

### Requirement: R-DOC-1 — OpenAPI from zod DTOs

The OpenAPI 3.1 spec MUST be generated from the zod DTO registry (single source of truth) and served as Swagger UI at `GET /api/docs` (public).

- **Scenario: docs served** — GIVEN running server THEN `GET /api/docs` → 200 HTML AND the generated spec JSON contains paths for all v1 endpoints.
- **Scenario: schema accuracy** — GIVEN a DTO change THEN the served spec reflects it without hand-editing (regeneration at startup).

### Requirement: R-DOC-2 — No hand-written docs

MUST NOT maintain a hand-written OpenAPI file; docs are derived at startup.

- **Scenario: derivation** — GIVEN repository scan THEN no static `openapi.json` source file in `src/` (generated artifact only at runtime).

---

# 9. Production (R-PROD)

### Requirement: R-PROD-1 — Multi-stage Docker, non-root, HEALTHCHECK

Dockerfile MUST be multi-stage (build → run), run as non-root user, expose only the API port, and define HEALTHCHECK hitting `/api/health`.

- **Scenario: image runs non-root** — GIVEN built image WHEN `docker run` THEN `id -u` inside container ≠ 0.
- **Scenario: healthcheck** — GIVEN compose up THEN container marked `healthy` within 30s of Postgres being up.

### Requirement: R-PROD-2 — Self-contained appliance (offline)

`docker compose up` MUST start the full stack locally without external services: API + worker + Postgres 16 + minimal UI; all reachable on localhost. Compose MUST include `mailpit` for dev SMTP and a migrate step.

- **Scenario: full stack** — GIVEN fresh machine with Docker WHEN `docker compose up` THEN health green AND UI reachable AND worker consuming jobs (verify via a confirm-order flow in the UI).

### Requirement: R-PROD-3 — CI pipeline

CI (on push/PR, `.github/workflows/ci.yml`) MUST run: install → migrate test DB → `tsc --noEmit` → `node --test` → Docker build → publish image to GitHub Container Registry (`ghcr.io`).

- **Scenario: green push** — GIVEN passing suite THEN workflow completes AND image tag published to GHCR.
- **Scenario: failing test** — GIVEN a failing test THEN workflow fails (red) AND no publish.

### Requirement: R-PROD-4 — CD: GHCR + optional Oracle Cloud Always Free

CD workflow (tag push) MUST publish the image to GHCR; an optional documented deploy path (Oracle Cloud Always Free VM) MUST be reproducible via documented runbook. No paid VPS, no Docker Hub requirement.

- **Scenario: publish on tag** — GIVEN `v*` tag pushed THEN GHCR package updated.
- **Scenario: runbook** — GIVEN `docs/deploy-oracle.md` THEN it contains exact commands from image pull to `compose up` with env setup.

### Requirement: R-PROD-5 — Fail-fast env validation

Startup MUST zod-validate env: `JWT_SECRET` ≥32 chars, `DATABASE_URL`, `SMTP_*`, `PORT`, etc. Invalid env → non-zero exit with a clear message that MUST NOT echo secret values.

- **Scenario: short secret** — GIVEN `JWT_SECRET="abc"` THEN server exits non-zero AND message mentions `JWT_SECRET` but not its value.

### Requirement: R-PROD-6 — Evidence per iteration

Each iteration MUST produce `docs/output-it<N>.txt` with suite results (test counts, requirement IDs) + demo commands, per lab methodology.

- **Scenario: evidence exists** — GIVEN iteration N merged THEN file exists AND lists green requirement-referenced tests.

### Requirement: R-PROD-7 — Minimal verification UI

The appliance MUST serve a lightweight non-React verification page (login + read views: customers, orders, stock, notifications) proving flows end-to-end. No React in v1 (locked).

- **Scenario: end-to-end** — GIVEN seeded data WHEN UI login (admin) THEN customer/order/stock lists render from the API.

### Requirement: R-PROD-8 — Repo + evidence dashboard

Repository MUST be named `business-operations-platform`; evidence dashboard (dashboard-pages pattern) MUST summarize the 7 iterations with links to evidence docs.

- **Scenario: dashboard** — GIVEN dashboard page THEN it lists iterations 1–7 with green status and links to `docs/output-it*.txt`.

---

# 10. Cross-cutting NFRs (R-NFR)

### Requirement: R-NFR-1 — Parameterized SQL only

All SQL MUST use parameterized queries ($1, $2…); user input MUST NEVER be interpolated into SQL strings. Injection attempts MUST be inert.

- **Scenario: injection attempt** — GIVEN search `q="'; DROP TABLE customers;--"` THEN 200 with empty results AND table intact.

### Requirement: R-NFR-2 — Secrets handling

Secrets (JWT, SMTP, DB) MUST come from validated env only; never hardcoded, never logged (pino redact covers auth/cookie/password/token paths); `JWT_SECRET` ≥32 chars.

- **Scenario: redact** — GIVEN request with Authorization header WHEN log line emitted THEN value absent.
- **Scenario: env only** — GIVEN source scan THEN no `SMTP_PASS`/`JWT_SECRET` literals in `src/`.

### Requirement: R-NFR-3 — Quality gate

`tsc --noEmit` with strict config (incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`) MUST pass; every functional requirement MUST have ≥1 test named with its requirement ID (e.g., `R-ORD-5: ...`); full suite green before merge.

- **Scenario: typecheck** — GIVEN codebase THEN `pnpm -w typecheck` exits 0.
- **Scenario: coverage of requirements** — GIVEN suite THEN every requirement ID from this spec appears in ≥1 test name.

### Requirement: R-NFR-4 — Architecture constraints

Controllers ≤15 lines, orchestration only; services framework-independent (no express/pg imports); DB access only in repositories; no business logic in DTOs. (Enforced by design review + spot tests.)

- **Scenario: review check** — GIVEN module scan THEN controllers contain no SQL and services import no `express`/`pg`.

### Requirement: R-NFR-5 — JWT verification discipline

`jwt.verify` + typ check + exp enforcement everywhere; no `jwt.decode`-only paths; no token values in DB (only SHA-256 hashes for refresh).

- **Scenario: scan** — GIVEN auth code THEN tests assert access tokens decode only after verify and refresh table stores hashes, not tokens.

### Requirement: R-NFR-6 — No N+1

List/detail endpoints MUST avoid N+1 (order detail ≤2 queries, customer list ≤2 queries, notifications list ≤2 queries).

- **Scenario: query count** — GIVEN order with 5 lines WHEN detail THEN ≤2 SQL statements (spy on pool).

---

# API Contract (surface, error, pagination)

## Resource surface (method, path, body, permission)

| Method | Path | Body / notes | Permission |
|---|---|---|---|
| POST | /api/auth/login | `{username,password}` → `{user,accessToken}` + refresh cookie | public |
| POST | /api/auth/refresh | cookie → new access + rotated cookie | public (cookie) |
| POST | /api/auth/logout | cookie → 204 | auth |
| GET | /api/auth/me | → `{user}` | auth |
| POST | /api/users | `{username,fullName,email,role,password}` → 201 | auth:user_create |
| GET | /api/users | paginated | auth:user_read |
| PATCH | /api/users/:id | `{role?,active?,password?}` | auth:user_update |
| POST | /api/customers | `{name,email?,phone?,notes?}` | crm:customer_create |
| GET | /api/customers | `?q&status&page&limit` | crm:customer_read |
| GET | /api/customers/:id | | crm:customer_read |
| PATCH | /api/customers/:id | `{name?,email?,phone?,notes?,status?}` | crm:customer_update |
| POST | /api/orders | `{customerId,lines[]}`, `Idempotency-Key` | orders:order_create |
| GET | /api/orders | `?status&customerId&page&limit` | orders:order_read |
| GET | /api/orders/:id | includes lines | orders:order_read |
| POST | /api/orders/:id/confirm | `Idempotency-Key` → 200 | orders:order_confirm |
| POST | /api/orders/:id/cancel | `{reason}` → 200 | orders:order_cancel |
| GET | /api/products | `?q&page&limit` | stock:stock_read |
| POST | /api/products | `{name,sku,lowStockThreshold}` | stock:product_manage |
| POST | /api/warehouses | `{name}` | stock:product_manage |
| GET | /api/stock | `?productId&warehouseId` | stock:stock_read |
| GET | /api/stock/movements | `?productId&type&page&limit` | stock:stock_read |
| POST | /api/stock/movements | `{type:"adjustment",productId,warehouseId,quantity,reason}`, `Idempotency-Key` | stock:stock_adjust |
| POST | /api/stock/transfers | `{productId,fromWarehouseId,toWarehouseId,quantity,reason}`, `Idempotency-Key` | stock:stock_transfer |
| GET | /api/notifications | `?unreadOnly&page&limit` (own rows) | notification:read |
| POST | /api/notifications/:id/read | → 204 (own rows) | notification:update |
| GET | /api/jobs | `?state&queue&page&limit` | jobs:job_read |
| POST | /api/jobs/:id/retry | → 200 | jobs:job_retry |
| GET | /api/audit | `?entity&action&from&to&page&limit` | audit:read |
| GET | /api/health | → 200/503 | public |
| GET | /api/status | → `{version,uptimeSeconds,db,timestamp}` | auth |
| GET | /api/docs | Swagger UI | public |
| GET | / | minimal verification UI | public |

## Error contract

All errors: `{error:{code,message}}`. Codes: `VALIDATION_ERROR` 422 · `UNAUTHORIZED` 401 (identical body everywhere) · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 with subcodes `USERNAME_TAKEN`, `DUPLICATE_EMAIL`, `INVALID_STATE`, `INSUFFICIENT_STOCK`, `NEGATIVE_STOCK`, `DUPLICATE_SKU` · `INTERNAL_ERROR` 500 (generic, no internals leaked). Idempotency replays return 200/201 with the original resource, never an error.

## Pagination

`page` ≥1 (default 1), `limit` 1–100 (default 20). Response: `{data:[...], pagination:{page,limit,total,totalPages}}`. Invalid page/limit → 422.

## Permission matrix (roles × permissions)

| Permission | admin | manager | operator | viewer | auditor |
|---|---|---|---|---|---|
| auth:user_create / user_read / user_update | ✅ | — | — | — | — |
| crm:customer_create / customer_update | ✅ | ✅ | ✅ | — | — |
| crm:customer_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| orders:order_create / confirm / cancel | ✅ | ✅ | ✅ | — | — |
| orders:order_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| stock:product_manage | ✅ | ✅ | — | — | — |
| stock:stock_adjust | ✅ | ✅ | ✅ | — | — |
| stock:stock_transfer | ✅ | ✅ | — | — | — |
| stock:stock_read | ✅ | ✅ | ✅ | ✅ | ✅ |
| jobs:job_read / job_retry | ✅ | ✅ | — | — | — |
| notification:read / update (own rows) | ✅ | ✅ | ✅ | ✅ | ✅ |
| audit:read | ✅ | — | — | — | ✅ |

# §3.1 — Orders↔Stock Atomic Contract (decision a, detailed)

1. **Transaction boundary**: `order.confirm` executes in ONE DB transaction: status transition + per-line sufficiency check + movement inserts + audit rows + notification rows + email-job enqueue (exactly-once via unique `(type, reference)`). Commit-all or rollback-all. No partial states observable.
2. **Sufficiency**: per line, inside the tx: acquire `pg_advisory_xact_lock(product_id)`; locks acquired in ascending product-id order (deadlock-free); read derived level; if `qty > level` → abort whole tx with 409 `INSUFFICIENT_STOCK` (rollback: order stays `draft`, zero movements/notifications/audit).
3. **Movement writes**: one immutable row per line: `(product_id, warehouse_id, type:'order_out', quantity, sign:-1, reason:'order <id> confirmed', idempotency_key)`; `idempotency_key` UNIQUE per product.
4. **Idempotency**: confirm accepts `Idempotency-Key`; a unique key per order stored at confirm; replay → 200 with original result, no new movements; same order + different key after confirmation → 409 `INVALID_STATE`.
5. **Failure paths**: any DB error → rollback → 500; insufficient stock → 409; duplicate key replay → 200; partial movement is impossible (single tx).
6. **Concurrency**: two concurrent confirms of the same order serialize on an order-level advisory lock; loser sees `confirmed` → 409. Concurrent adjustment vs confirm serialize on the product lock; negative-stock invariant holds in all interleavings (R-STK-5 test doubles as the proof).
7. **Audit rows written in this tx**: `order.confirm` (actor, entity order, payload: orderId, line count, movement ids, total); notification rows are not audit rows.

# §6.1 — Notification Channel Matrix (decision b, authoritative)

As the table in R-NOT-2. Rules: in-app row ALWAYS created when type lists in-app (target users per type rule: `order_confirmed`/`order_cancelled` → order creator; `low_stock` → all manager+operator; `stock_adjusted`/`stock_transferred` → admin+manager; `job_failed` → admin+manager); email job enqueued only when type lists email; SMTP send happens ONLY in the worker; SMTP failure → retry → dead-letter, never blocks or rolls back the originating transaction (R-NOT-4); notification row records delivery state. Recipient targeting rules are a design-phase decision; the matrix (which channels) is locked here.

# Test contract (apply phase)

- One test file per module; every test name prefixed with its requirement ID (`R-AUTH-2: ...`, `R-ORD-5: ...`).
- RED first (test fails with no implementation) → GREEN → TRIANGULATE (edge cases) → REFACTOR; evidence appended to `docs/output-it<N>.txt`.
- Concurrency tests (R-ORD-5, R-STK-5) run against real Postgres 16 (docker-compose), not mocks.
- SMTP assertions use mailpit; money assertions compare exact strings, never floats.

# Open items for design phase (spec-level decisions flagged)

1. `UNKNOWN_PRODUCT` on order create: 422 vs 409 (design confirms; spec allows either but must be consistent).
2. Notification recipient targeting rules (per type) — matrix channels locked, recipients open.
3. Same-tx pg-boss enqueue mechanism (pg-boss `send` inside tx vs post-commit enqueue + unique key) — the exactly-once contract is locked; mechanism is design's choice.
4. `low_stock` re-notification on each crossing movement (dedupe window) — v1 notifies per crossing event; dedupe is post-v1.
5. `/api/status` exposure: any authenticated user (locked in R-OBS-2) — confirm no stricter need.