# Specification: CAPSTONE — Business Operations Platform

Change: `capstone` · Project: `temporada-1` · Phase: **spec** · Artifact store: **hybrid**
Date: 2026-09-18 · Upstream: `proposal.md` (2026-09-18) · Downstream: design
Repo: `business-operations-platform` (user decision #9, RESOLVED) · New spec — `openspec/specs/` does not exist; this is the full v1 contract.
Merged: 2026-09-24 — `capstone-ui` change (React 19 SPA + system-wide ES/EN i18n + approved backend delta). R-NOT-5, R-PROD-3, R-PROD-7 updated in place; sections 11–16 appended; API contract extended (PATCH /api/auth/me, PATCH /api/products/:id, warehouses CRUD, `WAREHOUSE_IN_USE`). Verify reported 72/72 requirement-ID coverage across the delta specs; this merged spec is the authoritative v2 contract.

## Purpose

Define the complete, testable contract for the Business Operations Platform v1: auth/RBAC, CRM-lite, orders, stock ledger, jobs, notifications, audit, observability, OpenAPI, and production packaging. Every functional requirement carries a verifiable scenario (Given/When/Then) that maps 1:1 to a requirement-referenced test (e.g. `R-AUTH-2`) in the apply phase (STRICT TDD: RED → GREEN → TRIANGULATE → REFACTOR, evidence in `docs/output-*.txt`).

## Scope

**In (7 TDD iterations):** 1 foundation+auth/RBAC → 2 CRM-lite → 3 orders → 4 stock (atomic coupling) → 5 jobs/notifications → 6 audit+observability+OpenAPI → 7 production. Single backend package, two entrypoints (`server.ts`, `worker.ts`). Stack (locked): Express 5 · pg raw + repository · pg-boss v12 · jsonwebtoken + bcryptjs · zod v4 · node:test + supertest · pino (redact) · @asteasolutions/zod-to-openapi v9 · PostgreSQL 16 · Docker multi-stage non-root + HEALTHCHECK · CI/CD → GitHub Container Registry (free) · optional deploy → Oracle Cloud Always Free ($0).

**Out of scope (explicit, locked):** multi-tenancy, caching, rate limiting, PDFs, webhooks, rules engine, coverage gate, Redis/BullMQ, exp-02/04/05 reuse, stock reversal on order cancel (see R-ORD-6), password reset flow (see R-AUTH-1), Playwright e2e (deferred, locked). ~~Full React frontend in v1 (API-first + MINIMAL verification UI only), frontend tests~~ — superseded by `capstone-ui` (merged 2026-09-24): the React 19 SPA (§11–16) replaced the v1 vanilla verification UI (R-PROD-7 modified); the frontend vitest/RTL contract (R-UI-NFR-6) is now in scope.

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

### Requirement: R-NOT-5 — Bilingual templates per type, rendered at emit (MODIFIED by capstone-ui)

Each type MUST have a text template rendering `title` + `body` from its payload **in the recipient's stored locale** (`users.locale`, default `'es'`; fallback to `'es'` when the row is missing or invalid); email body MUST NOT contain secrets (tokens, passwords). Templates MUST exist in BOTH locales for EVERY type with key parity (R-BE-2). Rendering happens ONCE at emit time (immutable snapshot stored on the notification row, including the `locale` it was rendered in); the worker MUST NOT re-render — history keeps its rendered snapshot even if the recipient's locale later changes.
(Previously: English-only templates rendered once at emit time.)

- **Scenario: order_confirmed template ES** — GIVEN a recipient with `locale:'es'` WHEN an order confirm event emits THEN the row title/body are neutral Spanish and contain order id + total string.
- **Scenario: order_confirmed template EN** — GIVEN a recipient with `locale:'en'` WHEN the same event emits THEN the row renders in English (per-recipient rendering; two recipients with different locales get two differently-rendered rows).
- **Scenario: fallback es** — GIVEN a recipient whose stored locale is NULL/invalid WHEN emit THEN the row renders in 'es' and `locale` stores `'es'`.
- **Scenario: no secrets** — GIVEN any template in either locale THEN rendered body excludes credentials by construction (asserted for `user_invited` in both locales: no password value).
- **Scenario: history immutable** — GIVEN a notification row rendered in EN at emit THEN the user switches to 'es' and the row still displays its stored English title/body (R-UI-NOT-1).

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

### Requirement: R-PROD-3 — CI pipeline with frontend gate (MODIFIED by capstone-ui)

CI (on push/PR, `.github/workflows/ci.yml`) MUST run: install → migrate test DB → backend `tsc --noEmit` → backend `node --test` → **UI typecheck (`npm run typecheck -w ui`) → UI tests (`npm test -w ui`, vitest) → UI build (`npm run build -w ui`)** → Docker build → publish image to GitHub Container Registry (`ghcr.io`). A failing frontend step MUST fail the workflow; the backend suite MUST remain green with zero regressions.
(Previously: install → migrate → tsc → node --test → Docker build → publish.)

- **Scenario: green push** — GIVEN passing backend + frontend suites THEN workflow completes AND image tag published to GHCR.
- **Scenario: failing UI test** — GIVEN a failing vitest test THEN workflow fails (red) AND no publish.
- **Scenario: no backend regression** — GIVEN the full backend suite THEN all pass.

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

### Requirement: R-PROD-7 — Full React SPA served by the appliance (MODIFIED by capstone-ui)

The appliance MUST serve the React 19 SPA (`ui/dist`, built by Vite) at `/` with history-fallback for non-API routes; the SPA MUST prove all platform flows end-to-end: login, customers/products/warehouses CRUD, stock adjust/transfer, order create/confirm/cancel (atomic), notifications (bilingual), audit, jobs retry. The v1 vanilla verification UI (`ui/index.html` + `app.js`) is REPLACED and MUST NOT be served.
(Previously: lightweight non-React verification page with read views only; "No React in v1 (locked)".)

- **Scenario: end-to-end** — GIVEN seeded data WHEN SPA login (admin) THEN customers/products/stock/orders lists render from the API and a confirm-order flow completes.
- **Scenario: no vanilla files** — GIVEN the built container THEN `/` serves the SPA shell, not `app.js` (old files removed from the repo at it2).

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

# 11. UI Foundation (R-AUTHUI, R-UI-FND, R-RBAC, R-UI-NFR) — capstone-ui (React 19 SPA shell)

SPA shell contract (merged from `capstone-ui` 2026-09-24): routing + auth session (login, silent refresh, logout, boot restore), protected/role-aware navigation, and cross-cutting NFRs. Stack locked: React 19 + Vite 6 + react-router-dom 7 + React Compiler + strict TS. Frontend test runner: vitest + React Testing Library (new contract, R-UI-NFR-6).

### Requirement: R-AUTHUI-1 — Single-flight bounded refresh with exactly one retry

The API client MUST treat any 401 as "access token expired" and attempt ONE silent refresh (`POST /api/auth/refresh` with the httpOnly cookie); concurrent 401s MUST coalesce onto a single in-flight refresh (single-flight). After a successful refresh, exactly ONE retry of the failed request MUST occur. If refresh returns 401, the client MUST stop (no further retries), clear session state, and transition to the login screen. Infinite refresh loops MUST be impossible by construction (bounded: max 1 refresh + 1 retry per original request).

- **Scenario: expired mid-session** — GIVEN a 401 from `GET /api/orders` WHEN the client refreshes successfully THEN the original request retries once and renders data; refresh called exactly once.
- **Scenario: concurrent 401s** — GIVEN 4 parallel requests that all 401 WHEN they refresh THEN exactly 1 refresh request hits the network and all 4 retry and succeed.
- **Scenario: refresh fails** — GIVEN refresh returns 401 WHEN the client handles it THEN no retry of the original request occurs, state is cleared, and the router lands on `/login` (test asserts ≤1 refresh attempt and no loop).

### Requirement: R-AUTHUI-2 — Access token memory-only

The access token MUST live exclusively in memory (module-scoped variable/context). It MUST NOT be written to localStorage, sessionStorage, cookies, or any persistent store; it MUST NOT appear in console output or error reports.

- **Scenario: storage scan** — GIVEN a logged-in session WHEN `localStorage`/`sessionStorage` are enumerated THEN no `token`/`accessToken` key exists.
- **Scenario: reload logs out** — GIVEN a page reload (memory cleared) WHEN the app boots THEN it restores via silent refresh, never from storage.

### Requirement: R-AUTHUI-3 — Logout clears session and calls the API

Logout MUST call `POST /api/auth/logout` (idempotent 204) and THEN clear in-memory token + user state and redirect to `/login`. Logout MUST be reachable from the sidebar for every authenticated role.

- **Scenario: logout** — GIVEN an authenticated session WHEN the user clicks logout THEN `POST /api/auth/logout` fires, memory state clears, and the router lands on `/login`.
- **Scenario: logout already logged out** — GIVEN no session WHEN logout is invoked THEN the app stays on `/login` without error.

### Requirement: R-AUTHUI-4 — Boot session restore with route preservation

On boot, the app MUST attempt silent refresh (refresh cookie present → refresh → user). `ProtectedRoute` MUST render a loading state during restore and MUST remember the intended route; after successful restore the user lands on the intended route, and unauthenticated users are redirected to `/login` with the intended route preserved for post-login return.

- **Scenario: valid cookie** — GIVEN a valid refresh cookie WHEN the app boots on `/orders` THEN it restores silently and renders `/orders` (no login flash).
- **Scenario: no session** — GIVEN no cookie WHEN the app boots on `/orders` THEN it redirects to `/login?next=/orders` and after login returns to `/orders`.
- **Scenario: restore failure** — GIVEN refresh fails on boot WHEN the restore completes THEN the app lands on `/login` (bounded, no loop).

### Requirement: R-UI-FND-1 — Localized login form with identical-401 handling

The login form MUST collect username + password, submit `POST /api/auth/login`, and on 401 MUST display a single localized message ("Usuario o contraseña inválidos" / "Invalid username or password") identical for unknown-user and wrong-password (mirrors backend R-AUTH-2, no enumeration). The form MUST be usable and validated in both locales; the toggle (R-I18N-3) MUST work pre-auth.

- **Scenario: wrong password ES** — GIVEN locale 'es' WHEN the user submits a wrong password THEN one neutral-Spanish error message renders (no hint about which field failed).
- **Scenario: success** — GIVEN valid credentials WHEN submit THEN the client stores the token in memory, fetches `/api/auth/me` state, and routes to the intended page.
- **Scenario: pre-auth toggle persists** — GIVEN unauthenticated user toggles EN WHEN reload THEN the login form renders in EN (localStorage) and no API call fires.

### Requirement: R-UI-FND-2 — Sidebar layout with role-aware navigation

The shell MUST render a persistent sidebar (dark theme `#0f1115`, accent `#4f46e5`) listing exactly the modules the current role may access (R-RBAC-3 matrix), the active route highlighted, an unread-notifications badge (R-UI-NOT-3), the current user (name + role + locale), and the language toggle. Modules hidden per role MUST NOT be reachable by URL (route guard, R-RBAC-1).

- **Scenario: admin nav** — GIVEN admin WHEN the shell renders THEN the 9 sidebar modules from the R-RBAC-3 matrix appear (warehouses folded into Stock; Stock's 3 tabs are page-level, not sidebar entries).
- **Scenario: viewer nav** — GIVEN viewer WHEN the shell renders THEN only Dashboard, Customers, Products, Stock, Orders, Notifications appear and zero write actions are visible anywhere in the shell.

### Requirement: R-UI-FND-3 — Loading, empty, error states and toasts

Every module list/detail MUST render a distinct loading state (skeleton/spinner) while fetching, a localized empty state ("No hay registros" / "No records") when the collection is empty, and a localized error state with retry when a request fails (except 401, which routes to the refresh flow). Mutation results MUST surface via localized toasts (success, conflict, error).

- **Scenario: empty list** — GIVEN `GET /api/customers` returns `{data: [], pagination: {total: 0}}` WHEN the Customers page loads THEN the localized empty state renders, not a table with zero rows.
- **Scenario: network error** — GIVEN `GET /api/products` rejects (500) WHEN the page loads THEN the localized error state renders with a retry button that re-fetches.

### Requirement: R-UI-FND-4 — Idempotency-Key per mutation submit

Every mutating form that maps to an idempotent backend endpoint (order create/confirm, stock adjust/transfer) MUST generate a fresh `Idempotency-Key` (UUID) per user submit and send it in the header. A duplicate submit (same form, same key) MUST NOT create a second resource; a 200 replay response MUST be treated as success without double-rendering.

- **Scenario: double-click create** — GIVEN the user double-clicks submit WHEN the first request succeeds THEN the second (same key) returns 200 replay and the list shows exactly one new row.
- **Scenario: fresh key per submit** — GIVEN the same form submitted twice as separate actions THEN two distinct keys are sent and two resources are created (per backend semantics).

### Requirement: R-RBAC-1 — Route guards mirror backend permissions

Each module route MUST be wrapped in a guard that checks the current role's permissions (from the login/me payload, refreshed via `/api/auth/me`); a user navigating to a forbidden route MUST be redirected to the Dashboard with a localized "no permission" toast, not an API 403 page. Guards MUST use the SAME role→permission mapping as the backend `ROLE_PERMISSIONS` registry (parity-tested).

- **Scenario: viewer hits /users** — GIVEN viewer role WHEN the URL is `/users` THEN redirect to `/dashboard` + localized denial toast; no `GET /api/users` request fires.
- **Scenario: auditor hits /audit** — GIVEN auditor WHEN the URL is `/audit` THEN the page renders in read-only mode (allowed).

### Requirement: R-RBAC-2 — Action-level guards

Action buttons (create/edit/delete/confirm/cancel/retry/adjust/transfer/mark-read) MUST be hidden — not merely disabled — when the role lacks the corresponding backend permission. The visibility matrix in R-RBAC-3 is authoritative; a component test MUST assert, for each of the 5 roles, the exact set of visible actions.

- **Scenario: operator buttons** — GIVEN operator on Stock WHEN rendering THEN "Ajustar" (adjust) is visible and "Transferir" (transfer) is hidden (no `stock:stock_transfer`).
- **Scenario: manager jobs** — GIVEN manager on Jobs WHEN rendering THEN "Reintentar" (retry) is visible; GIVEN operator THEN the Jobs module itself is absent.

### Requirement: R-RBAC-3 — Role × module × action visibility matrix

The sidebar and action visibility MUST match exactly (permission codes from `ROLE_PERMISSIONS`):

| Module / Action | admin | manager | operator | viewer | auditor |
|---|---|---|---|---|---|
| Dashboard (health/status/counts) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Customers — view | ✅ | ✅ | ✅ | ✅ | ✅ |
| Customers — create/edit/deactivate | ✅ | ✅ | ✅ | — | — |
| Products — view | ✅ | ✅ | ✅ | ✅ | ✅ |
| Products — create/edit/deactivate | ✅ | ✅ | — | — | — |
| Warehouses — create (in Stock module) | ✅ | ✅ | — | — | — |
| Stock levels — view | ✅ | ✅ | ✅ | ✅ | ✅ |
| Stock — adjust | ✅ | ✅ | ✅ | — | — |
| Stock — transfer | ✅ | ✅ | — | — | — |
| Orders — view/detail | ✅ | ✅ | ✅ | ✅ | ✅ |
| Orders — create/confirm/cancel | ✅ | ✅ | ✅ | — | — |
| Notifications — view/mark-read (own rows) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Audit — view | ✅ | — | — | — | ✅ |
| Users — view/create/edit | ✅ | — | — | — | — |
| Jobs — view/retry | ✅ | ✅ | — | — | — |

- **Scenario: five-role sweep** — GIVEN a test harness that mounts the shell once per role WHEN the sidebar and every module's action area render THEN the visible set equals the matrix row for that role (exact match, no extra, no missing).
- **Scenario: matrix parity** — GIVEN the UI role→permission const map WHEN a test compares it to the backend `ROLE_PERMISSIONS` values THEN they are identical sets (parity test keeps the UI honest when backend RBAC changes).

### Requirement: R-RBAC-4 — Mid-session role change reflects on next user fetch

A role demotion/promotion applied by an admin MUST take effect in the UI on the next `/api/auth/me` (or refresh) response without re-login: the sidebar and action visibility MUST re-render from the fresh user payload. A 403 from an endpoint the stale UI still shows MUST surface the localized denial toast and update visibility (no crash).

- **Scenario: demoted mid-session** — GIVEN operator demoted to viewer WHEN the next `/api/auth/me` resolves THEN the sidebar drops create/edit actions immediately.
- **Scenario: stale 403** — GIVEN the UI shows a create button but the API returns 403 WHEN submit THEN a localized "no permission" toast renders and the button disappears after the next user fetch.

### Requirement: R-UI-NFR-1 — Strict TypeScript quality gate

The `ui` workspace MUST pass `tsc --noEmit` with the same strict flags as the backend (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`). No `any`; const-types pattern (`const X = {...} as const` + derived union) for every domain enum; flat interfaces; `import type` for type-only imports.

- **Scenario: typecheck green** — GIVEN the ui workspace WHEN `npm run typecheck -w ui` runs THEN exit 0.
- **Scenario: no any** — GIVEN a repo scan of `ui/src` WHEN searching for `: any` / `as any` THEN zero matches.

### Requirement: R-UI-NFR-2 — No XSS surface with user data

All user/API-derived strings MUST render through React's escaping. `dangerouslySetInnerHTML` MUST NOT be used with any data that originated from the API or user input; rendered notification/audit payloads MUST display as plain text.

- **Scenario: script in name** — GIVEN a customer named `<img src=x onerror=alert(1)>` WHEN the Customers page renders THEN the literal text displays and no script executes (RTL asserts text content only).

### Requirement: R-UI-NFR-3 — No secrets in the client bundle

Env/config values MUST enter via `import.meta.env` (Vite `VITE_*` prefix) only; no API keys, JWT secrets, SMTP credentials, or database URLs MAY be hardcoded or bundled. The access token MUST remain memory-only (R-AUTHUI-2).

- **Scenario: bundle scan** — GIVEN the built `ui/dist` assets WHEN scanned for `JWT_SECRET`, `SMTP_`, `DATABASE_URL`, `password` literals THEN zero matches (code-auditor).

### Requirement: R-UI-NFR-4 — React Compiler on, no manual memoization

The app MUST run with `babel-plugin-react-compiler` enabled; components MUST NOT use `useMemo`/`useCallback` for memoization (React Compiler handles it); mutations MAY use `useActionState`/`useOptimistic`; `use()` for promises/context; `ref` as a regular prop (no forwardRef).

- **Scenario: compiler config** — GIVEN the Vite config WHEN a test asserts the React Compiler plugin is present AND a scan finds no `useMemo(`/`useCallback(` in `ui/src` THEN both pass.

### Requirement: R-UI-NFR-5 — Performance

Route-level code-splitting (lazy module pages) SHOULD be used so the initial bundle excludes governance pages (audit/users/jobs); the login → dashboard critical path MUST render without loading non-visible modules. (MAY — measurable: initial `dist` chunk for login+dashboard ≤ 250 KB gzipped, verified in CI build output.)

- **Scenario: split chunks** — GIVEN `vite build` WHEN `dist` is produced THEN governance pages are NOT in the initial chunk (or the size cap is met).

### Requirement: R-UI-NFR-6 — Frontend test contract (vitest + RTL)

The `ui` workspace MUST use vitest + @testing-library/react + jsdom + user-event. Required coverage: component tests for login form, refresh flow (single-flight/bounded), route guards, create-form validation, confirm-order button, i18n toggle; page tests for each module list view. Backend integration MUST use a mocked fetch client (contract-tested against the OpenAPI shape), NEVER a live backend in unit tests. Every test name MUST be prefixed with its requirement ID (`R-AUTHUI-1: ...`, `R-UI-CRM-2: ...`). Playwright e2e is DEFERRED (locked decision).

- **Scenario: refresh flow test** — GIVEN a mocked fetch that 401s once THEN `R-AUTHUI-1: concurrent 401s coalesce onto one refresh` passes with exactly 1 refresh call.
- **Scenario: requirement coverage** — GIVEN the suite WHEN scanning test names THEN every requirement ID in this change's specs appears in ≥1 test name (mirrors R-NFR-3).

### Requirement: R-UI-NFR-7 — Production build, container, CI, evidence

`npm run build -w ui` MUST produce `ui/dist` via Vite. The Dockerfile MUST add a UI build stage (`npm ci` + `npm run typecheck -w ui` + `npm test -w ui` + `npm run build -w ui`) and the runtime stage MUST copy `ui/dist`; express serves it with the SPA fallback (R-BE-5). CI MUST add the ui typecheck + tests + build steps BEFORE the Docker build; the backend `node --test` suite MUST stay green (no regressions). Each iteration MUST produce `docs/output-ui-it<N>.txt` with green requirement-referenced tests + demo commands, and the evidence dashboard MUST list the UI iterations.

- **Scenario: CI green** — GIVEN the workflow WHEN a passing PR runs THEN backend suite + ui typecheck + ui tests + ui build + Docker build all pass.
- **Scenario: evidence** — GIVEN iteration N merged THEN `docs/output-ui-it<N>.txt` exists listing green tests per requirement ID.

# 12. UI Dashboard (R-UI-DSH) — capstone-ui

The Dashboard is the "practical" landing page that replaces the rejected v1 flat dashboard: system status, KPI counts, low-stock and notification alerts. All roles see the Dashboard (read-only).

### Requirement: R-UI-DSH-1 — Status and KPI cards

The Dashboard MUST render: (a) a system card from `GET /api/status` (version, uptime, db up/down, timestamp) and `GET /api/health`; (b) KPI cards for total customers (`GET /api/customers?limit=1` → pagination.total), total products (`GET /api/products?limit=1`), and total orders (`GET /api/orders?limit=1`). Each card MUST show a localized label and a loading state while fetching; a failed card MUST show its own localized error with retry without blocking the others.

- **Scenario: admin KPIs** — GIVEN 25 customers, 8 products, 14 orders WHEN Dashboard loads THEN cards show 25 / 8 / 14 and the status card shows `ok` + version.
- **Scenario: partial failure** — GIVEN `GET /api/status` 503s (db down) WHEN the page loads THEN the status card renders the degraded state while the count cards still render.
- **Scenario: role parity** — GIVEN viewer or auditor WHEN Dashboard loads THEN the same cards render (all roles have the underlying read permissions).

### Requirement: R-UI-DSH-2 — Low-stock alert card

The Dashboard MUST surface products at or below their low-stock threshold, derived client-side from `GET /api/stock` (rows where `level <= lowStockThreshold` for the product — threshold compared via the product record from `GET /api/products` when available, else from the stock row set). The card MUST list product name, SKU, level, threshold and a localized message ("Stock bajo" / "Low stock"); an empty result MUST render the localized "no alerts" state.

- **Scenario: alerts present** — GIVEN a product with threshold 5 and level 3 WHEN Dashboard loads THEN the low-stock card lists it with level 3 / threshold 5.
- **Scenario: none low** — GIVEN all levels above thresholds WHEN Dashboard loads THEN the card renders "Sin alertas de stock" (no list rows).

### Requirement: R-UI-DSH-3 — Recent notifications summary

The Dashboard MUST render the 5 most recent unread notifications (`GET /api/notifications?unreadOnly=true&limit=5`) with title/type/createdAt (stored snapshot, per R-BE-3) and link to the Notifications page. The nav unread badge (R-UI-NOT-3) and this card MUST stay consistent after mark-read.

- **Scenario: summary** — GIVEN 3 unread notifications WHEN Dashboard loads THEN the card lists them; after marking one read on the Notifications page and returning, the card shows 2.

### Requirement: R-UI-DSH-4 — On-demand refresh

The Dashboard MUST provide a refresh control (button) that re-fetches all cards and updates without a full page reload; a refresh failure MUST NOT clear previously rendered data (stale-while-revalidating on error).

- **Scenario: refresh** — GIVEN loaded Dashboard WHEN the user clicks refresh THEN all cards re-fetch and update (mock asserts 2nd round of calls); on a failed re-fetch the previous values remain visible with the error toast.

# 13. UI CRM — Customers, Products, Warehouses (R-UI-CRM) — capstone-ui

CRM module contract: customers CRUD (search/filter/pagination, localized validation), products list/create/edit/deactivate, warehouses CRUD — mirroring the (extended) backend surface. API error codes (409/422/403/404) map to localized friendly messages via `localizeError` (R-I18N-4).

### Requirement: R-UI-CRM-1 — Customers list with search, status filter, pagination

The Customers page MUST render a paginated table from `GET /api/customers?q=&status=&page=&limit=` with columns name, email, phone, status, createdAt; a search input (`q`, debounced), a status select (all/active/inactive), pagination controls (page/total/totalPages), and per-row Edit/Deactivate actions per role (R-RBAC-2). The list MUST NOT show inactive customers when no filter is set (backend default, R-CRM-4).

- **Scenario: search** — GIVEN customers "Ana Ruiz" and "Luis Paz" WHEN the user types `ana` THEN only Ana renders.
- **Scenario: pagination** — GIVEN 25 customers WHEN page 2 / limit 10 THEN rows 11–20 render with `total 25`, `totalPages 3`, and page 3 reachable.
- **Scenario: empty result** — GIVEN `q=zzz` with no matches THEN the localized empty state renders (R-UI-FND-3).
- **Scenario: 403** — GIVEN a viewer somehow reaches the page (guard bypass) WHEN the API returns 403 THEN the localized denial toast renders, not a crash.

### Requirement: R-UI-CRM-2 — Create customer form with localized validation

The create form (modal or page) MUST collect name (required), email (format), phone, notes and submit `POST /api/customers`. Client validation MUST block empty name and malformed email BEFORE submit; server 422 MUST render the localized field error; 409 `DUPLICATE_EMAIL` MUST render "Ese correo ya está en uso" / "That email is already in use". On 201 the list MUST refresh and a success toast renders.

- **Scenario: invalid email client-side** — GIVEN `email: "x"` WHEN submit THEN a localized email-format error renders and NO request fires.
- **Scenario: duplicate email** — GIVEN an existing email WHEN submit THEN the localized 409 message renders and the form stays open with data intact.
- **Scenario: success** — GIVEN valid input WHEN submit THEN 201, toast, list refresh with the new customer on top.

### Requirement: R-UI-CRM-3 — Edit customer

Edit MUST open a form pre-filled from the row, submit `PATCH /api/customers/:id` with changed fields, and render localized 404 ("Cliente no encontrado") and 409 (duplicate email) errors. Only `crm:customer_update` roles see the button (R-RBAC-2).

- **Scenario: update phone** — GIVEN customer WHEN the user edits phone only THEN PATCH sends `{phone}` and the row updates.
- **Scenario: unknown id** — GIVEN id removed concurrently WHEN PATCH THEN the localized 404 renders and the list refreshes.

### Requirement: R-UI-CRM-4 — Deactivate / reactivate customer

Deactivate MUST require an explicit confirm step (atomic confirm pattern — the action button turns into "Confirmar" before submitting), then `PATCH /api/customers/:id {status:"inactive"}`. The inactive customer MUST disappear from the unfiltered list; reactivation MUST be available from the "inactive" filter view. A confirmation cancel MUST NOT fire any request.

- **Scenario: confirm gate** — GIVEN a customer row WHEN the user clicks Deactivate THEN a confirm state renders; clicking the actual confirm button fires the PATCH; clicking away fires nothing.
- **Scenario: reactivate** — GIVEN the inactive filter THEN the row shows Activate; clicking it PATCHes `{status:"active"}` and the row returns to the default list.

### Requirement: R-UI-CRM-5 — Products list

The Products page MUST render a paginated table from `GET /api/products?q=&page=&limit=` (name, sku, lowStockThreshold, active) with search and per-row actions per role. Deactivated products MUST render with a visible "inactive" badge; stock levels for inactive products are excluded by the backend (R-STK-8, verified `WHERE p.active = true`) and MUST NOT appear in the Stock module.

- **Scenario: list + search** — GIVEN products WHEN `q` filters by name/sku THEN matching rows render; inactive rows show the badge.

### Requirement: R-UI-CRM-6 — Create product

Create MUST collect name (required), sku (required, `[A-Za-z0-9._-]`), lowStockThreshold (int ≥ 0, default 0) and submit `POST /api/products`. 409 `DUPLICATE_SKU` MUST render "Ese SKU ya existe" / "That SKU already exists"; 422 renders per-field localized messages. Only `stock:product_manage` roles (admin/manager) see the button.

- **Scenario: duplicate sku** — GIVEN an existing SKU WHEN submit THEN the localized 409 renders, form data intact.
- **Scenario: threshold validation** — GIVEN `lowStockThreshold: -1` WHEN submit THEN a localized error renders client-side (int ≥ 0), no request.

### Requirement: R-UI-CRM-7 — Product edit / deactivate (PATCH /api/products/:id — delta approved)

The UI MUST expose edit (name/sku/threshold) and deactivate (never hard-delete, confirm-gated like R-UI-CRM-4) for `stock:product_manage` roles, backed by the additive `PATCH /api/products/:id {name?, sku?, lowStockThreshold?, active?}` (≥1 field refine; permission `stock:product_manage`; 404 unknown id; 409 `DUPLICATE_SKU`). `active:false` = deactivate; stock levels for inactive products stay in the ledger but `GET /api/stock` excludes them (verified).

- **Scenario: deactivate** — GIVEN the confirm gate WHEN the user confirms THEN `PATCH {active:false}` fires and the row shows the inactive badge and disappears from Stock levels.
- **Scenario: 409** — GIVEN a duplicate SKU on edit THEN the localized 409 renders.

### Requirement: R-UI-CRM-8 — Warehouses: CRUD in the Stock module (delta approved)

Warehouse management MUST live inside the Stock module (locked decision: manager+). The UI MUST offer list (`GET /api/warehouses`, `stock:stock_read` — operators need it for the adjust pickers), create (`POST /api/warehouses {name}`, 422 localized), rename (`PATCH /api/warehouses/:id {name}`, 404 / 409 duplicate name) and delete (`DELETE /api/warehouses/:id` → 204 only when no movement references the warehouse, else 409 `WAREHOUSE_IN_USE`) for `stock:product_manage` roles. The warehouse picker in adjust/transfer forms MUST use this list.

- **Scenario: create warehouse** — GIVEN manager WHEN create with a valid name THEN 201 and the warehouse appears in the list after refresh.
- **Scenario: duplicate/422** — GIVEN an empty name WHEN submit THEN localized 422 renders, no request with empty name.
- **Scenario: delete in use** — GIVEN a warehouse referenced by a movement WHEN delete THEN 409 `WAREHOUSE_IN_USE` localized, row stays.
- **Scenario: picker** — GIVEN 2 warehouses WHEN the transfer form opens THEN both appear in the from/to selects (operator sees them for adjust too).

# 14. UI Stock & Orders (R-UI-STK, R-UI-ORD) — capstone-ui (showpiece)

Stock (levels/movements/adjust/transfer) and Orders (list/detail/create/confirm/cancel) — the atomic order↔stock showpiece. Idempotency-Key per mutation (R-UI-FND-4), D13 money as strings, 409 conflicts surfaced with ZERO side effects (backend guarantee, R-ORD-5/R-STK-3 — the UI must reflect that the order stays `draft` / stock unchanged).

### Requirement: R-UI-STK-1 — Stock levels table with low-stock badge

The Stock page MUST render the unpaginated `GET /api/stock` collection (rows per product×warehouse: sku, product name, warehouse, level) with optional `productId`/`warehouseId` filters. A row whose level is below the product's threshold MUST show a localized "stock bajo" badge. Levels are strings from the API; display MUST NOT coerce to floats.

- **Scenario: rows render** — GIVEN 2 products × 2 warehouses WHEN loaded THEN 4 rows render with string levels.
- **Scenario: low badge** — GIVEN level `"3"` and threshold 5 THEN the row shows the low-stock badge; level `"5"` (equal) also counts as low (`level <= threshold`).
- **Scenario: filters** — GIVEN `warehouseId` filter WHEN applied THEN only that warehouse's rows render.

### Requirement: R-UI-STK-2 — Movements history

The Movements tab MUST render `GET /api/stock/movements?productId=&type=&page=&limit=` newest-first (columns: date, type, product, warehouse, quantity, sign, reason) with pagination and filters (product, type: adjustment/transfer_out/transfer_in/order_out). Each adjustment/transfer submission MUST refresh this list.

- **Scenario: filter by type** — GIVEN mixed movements WHEN `type=adjustment` THEN only adjustment rows render.
- **Scenario: pagination** — GIVEN >limit movements THEN page controls render and page 2 loads the next batch.

### Requirement: R-UI-STK-3 — Adjust stock (signed quantity, reason, idempotent)

The adjust form MUST collect product, warehouse, a NON-ZERO signed integer quantity (up = positive, down = negative — mirrors the DTO), and reason ≥ 10 chars, then submit `POST /api/stock/movements` with an `Idempotency-Key`. Client validation MUST block qty = 0 and reason < 10 before submit. A 409 `NEGATIVE_STOCK` MUST render "Stock insuficiente para esa operación" / "Insufficient stock for that operation" and MUST NOT change the displayed level (zero side effects); the user MUST be able to retry with a NEW key (old key is consumed).

- **Scenario: adjust up** — GIVEN level `"10"` WHEN qty +5, reason "Ajuste de inventario inicial" THEN 201 and the level cell updates to `"15"`.
- **Scenario: below zero** — GIVEN level `"3"` WHEN qty −5 THEN the localized 409 renders and the level cell stays `"3"`.
- **Scenario: validation** — GIVEN qty 0 or reason "x" WHEN submit THEN localized client errors render, no request.
- **Scenario: replay 200** — GIVEN a submit retried with the SAME key (double-click) THEN the second response is 200 replay and exactly one movement appears in history.

### Requirement: R-UI-STK-4 — Transfer stock (from ≠ to, reason, idempotent)

The transfer form MUST collect product, fromWarehouse, toWarehouse, quantity (int ≥ 1), reason ≥ 10 and submit `POST /api/stock/transfers` with an `Idempotency-Key`. Client MUST block from = to (localized "Las bodegas deben ser diferentes" / "Warehouses must differ"). A 409 — backend code `NEGATIVE_STOCK` for source insufficiency (verified; `INSUFFICIENT_STOCK` also mapped by R-I18N-4) — MUST render the localized message and leave both level cells unchanged; 422 for reason/quantity renders per-field errors.

- **Scenario: transfer ok** — GIVEN A=`"10"`, B=`"0"` WHEN transfer 4 A→B THEN A shows `"6"`, B shows `"4"`, and 2 ledger rows appear in history.
- **Scenario: same warehouse** — GIVEN from = to WHEN submit THEN localized client error, no request.
- **Scenario: insufficient source** — GIVEN A=`"2"` WHEN transfer 5 THEN localized 409 and both cells unchanged.

### Requirement: R-UI-ORD-1 — Orders list with state filter and pagination

The Orders page MUST render `GET /api/orders?status=&customerId=&page=&limit=` (columns: id, customer, state with localized label/badge, total D13, createdAt, actions per state) with a state filter (all/draft/confirmed/cancelled) and pagination. Only draft orders show Confirm; draft or confirmed show Cancel (per R-RBAC-2). The customer column renders the authoritative `#<customerId>` — the backend `OrderListItemDto` carries no customer name (accepted deviation; a future additive DTO field would polish UX).

- **Scenario: filter** — GIVEN 3 orders (2 confirmed) WHEN `status=confirmed` THEN 2 rows render.
- **Scenario: badge labels** — GIVEN locale 'es' THEN state badges render "Borrador / Confirmada / Cancelada".

### Requirement: R-UI-ORD-2 — Order detail with lines

Detail MUST render `GET /api/orders/:id` (order + lines: product name, qty, unitPrice, line total, order total as D13 strings, state, customer, createdAt) and format money per locale (R-UI-ORD-6). A 404 MUST render the localized not-found state with a link back to the list.

- **Scenario: detail** — GIVEN order id WHEN loaded THEN lines and total render from the API strings (exact, e.g. `"12.50"`).
- **Scenario: unknown id** — GIVEN id 9999 WHEN loaded THEN localized 404 state, no crash.

### Requirement: R-UI-ORD-3 — Create order with dynamic line editor

Create MUST open a form with customer select + dynamic line rows (product select, qty int ≥ 1, unitPrice D13 with scale ≤ 2, remove-row; add-line button; ≥ 1 line enforced client-side). Submit `POST /api/orders` with an `Idempotency-Key`. Client validation blocks empty customer, zero lines, qty < 1, unitPrice with scale > 2 or non-numeric, BEFORE submit. Server 422 (e.g. `UNKNOWN_PRODUCT`) and 409 render localized messages with the form intact. On 201 the new order appears in the list as `draft`.

- **Scenario: two lines** — GIVEN customer + 2 valid lines WHEN submit THEN 201, order shows as draft, list refreshes.
- **Scenario: scale > 2** — GIVEN unitPrice `"0.001"` WHEN submit THEN a localized client error on that line, no request.
- **Scenario: zero lines** — GIVEN an empty line list WHEN submit THEN localized "al menos una línea" error, no request.
- **Scenario: double submit** — GIVEN the same key replayed THEN exactly one order exists (replay 200).

### Requirement: R-UI-ORD-4 — Confirm order (optimistic, atomic 409 clean)

Confirm MUST run against a draft order: the UI updates the row optimistically (pending state) while `POST /api/orders/:id/confirm` (with `Idempotency-Key`) executes; on success the row becomes `confirmed` with a success toast. On 409 `INSUFFICIENT_STOCK` the optimistic change MUST roll back and the localized message MUST render ("Stock insuficiente para confirmar el pedido") with the order still `draft` and the stock module showing ZERO movements for this order (backend all-or-nothing). On 409 `INVALID_STATE` (already confirmed elsewhere) the row MUST refresh from the server. Confirm MUST be a two-step (button → confirm) action.

- **Scenario: happy path** — GIVEN a draft order with sufficient stock WHEN confirm THEN optimistic pending → confirmed, toast, stock levels drop by the line quantities.
- **Scenario: insufficient** — GIVEN line qty > available WHEN confirm THEN 409 localized, order stays draft, level cells unchanged, movements history shows no order_out rows.
- **Scenario: already confirmed** — GIVEN a confirmed order (different tab) WHEN confirm THEN 409 `INVALID_STATE` localized and the row refreshes to confirmed.
- **Scenario: confirm gate** — GIVEN the two-step action WHEN the user cancels the confirm step THEN no request fires.

### Requirement: R-UI-ORD-5 — Cancel order with reason

Cancel MUST collect a reason ≥ 10 chars (client-blocked otherwise) and submit `POST /api/orders/:id/cancel`. Success → `cancelled` state + localized toast; the stock module MUST remain unchanged (no reversal movements — R-ORD-6). 409 `INVALID_STATE` (already cancelled/confirmed-elsewhere) renders localized with a server refresh.

- **Scenario: cancel draft** — GIVEN a draft order WHEN cancel with reason "El cliente canceló la compra" THEN state becomes cancelled and stock levels do NOT change.
- **Scenario: short reason** — GIVEN reason "x" WHEN submit THEN localized client error, no request.

### Requirement: R-UI-ORD-6 — D13 money formatting per locale

All money display MUST format the API's D13 strings with `Intl.NumberFormat` using the ACTIVE locale (`es-ES` for 'es', `en-US` for 'en' — e.g. "12,50 €" vs "$12.50" per a shared currency formatter), while every payload sent to the API MUST remain a 2-decimal string ("12.50"). Money MUST NEVER be parsed to JS floats for display.

- **Scenario: es format** — GIVEN `"12.50"` and locale 'es' THEN the UI renders "12,50 €" (decimal comma).
- **Scenario: en format** — GIVEN the same string and locale 'en' THEN the UI renders "$12.50".
- **Scenario: round-trip** — GIVEN the form collects "12,50" in ES THEN the request body carries `"12.50"` (normalized, scale ≤ 2).

# 15. UI Governance (R-UI-NOT, R-UI-AUD, R-UI-USR, R-UI-JOB) — capstone-ui

Governance module contracts: notifications (read/unread, mark-read, badge), audit (filterable, admin/auditor), users (admin invite/create/activate), jobs (manager+ list/retry). All list views follow the pagination + empty/loading/error contract (R-UI-FND-3).

### Requirement: R-UI-NOT-1 — Notifications list with unread filter

The Notifications page MUST render `GET /api/notifications?unreadOnly=&page=&limit=` (OWN rows only, per R-NOT-1) with columns type, title, body (stored snapshot — rendered at emit, NEVER re-rendered client-side, R-BE-3), created_at, read state, and an unread-only toggle. The body/title MUST display as plain text (R-UI-NFR-2).

- **Scenario: unread filter** — GIVEN 3 notifications (1 read) WHEN `unreadOnly=true` THEN 2 rows render.
- **Scenario: snapshot display** — GIVEN a notification row with `locale:'en'` and English title while the current UI locale is 'es' THEN the stored English title renders (no re-translation).

### Requirement: R-UI-NOT-2 — Mark read, idempotent

Mark-read (per-row button or "mark all visible") MUST call `POST /api/notifications/:id/read` (204); the row MUST visually update to read immediately after success; a second call on the same row MUST NOT error (idempotent). The nav badge (R-UI-NOT-3) MUST decrement.

- **Scenario: mark one** — GIVEN an unread row WHEN the user clicks it THEN 204, row shows read, badge count −1.
- **Scenario: double mark** — GIVEN a read row WHEN the user clicks again THEN 204 (idempotent) and no visual change.

### Requirement: R-UI-NOT-3 — Unread badge in the shell

The sidebar (R-UI-FND-2) MUST show a badge with the unread count from `GET /api/notifications?unreadOnly=true&limit=1` (pagination.total). The badge MUST refresh after mark-read and on shell mount/navigation; zero unread MUST hide the badge.

- **Scenario: badge count** — GIVEN 5 unread WHEN the shell mounts THEN the badge shows 5; after marking 2 read it shows 3.
- **Scenario: zero** — GIVEN no unread THEN no badge renders.

### Requirement: R-UI-AUD-1 — Audit trail table (admin/auditor only)

The Audit page MUST render `GET /api/audit?entity=&action=&from=&to=&page=&limit=` newest-first (columns: timestamp, actor, entity, entityId, action, payload) with filters for entity and action, plus date-from/to inputs. Only `audit:read` roles (admin/auditor) reach it (R-RBAC-1); the payload column MUST render as JSON text (never executed, R-UI-NFR-2). An operator visiting the route MUST be redirected (R-RBAC-1 scenario).

- **Scenario: filter** — GIVEN audit rows WHEN `entity=customer&action=customer.create` THEN only matching rows render.
- **Scenario: 403 guard** — GIVEN operator role WHEN navigating to /audit THEN redirect + denial toast, no request.
- **Scenario: payload text** — GIVEN a payload containing `<script>` WHEN rendering THEN literal text displays.

### Requirement: R-UI-USR-1 — Users list (admin only)

The Users page MUST render `GET /api/users?page=&limit=` (username, fullName, email, role, active, createdAt) with role/active badges and pagination. Only admin sees the module (R-RBAC-3).

- **Scenario: list** — GIVEN users WHEN loaded THEN rows with role badges render; pagination works.
- **Scenario: guard** — GIVEN manager WHEN navigating to /users THEN redirect + denial toast (no `auth:user_read`).

### Requirement: R-UI-USR-2 — Create/invite user (admin)

Create MUST collect username (3–50, `[A-Za-z0-9_]`), fullName, email, role (5 roles), password (12–128, ≥1 letter + ≥1 digit, with a live strength hint) and submit `POST /api/users`. **Locale is NOT part of this form** (locked delta — the approved backend change adds locale only via migration + `PATCH /api/auth/me`; new users default to 'es' and self-serve later). 409 `USERNAME_TAKEN` renders "Ese nombre de usuario ya existe"; 422 renders per-field localized messages. Success → 201 + toast + `user_invited` email job (backend) — the UI MUST state "Se envió una invitación por correo" without leaking the password anywhere.

- **Scenario: create** — GIVEN admin + valid payload WHEN submit THEN 201, list refresh, invitation toast (no password echoed).
- **Scenario: weak password** — GIVEN password `abc` WHEN submit THEN client-side localized strength error, no request.
- **Scenario: duplicate username** — GIVEN existing username WHEN submit THEN localized 409, form intact.
- **Scenario: no locale field** — GIVEN the form renders THEN NO locale input exists (asserted; locale is self-service).

### Requirement: R-UI-USR-3 — Edit user: role change + activate/deactivate

Per-row actions (admin) MUST submit `PATCH /api/users/:id` — role change and `active` toggle (deactivate confirm-gated). A demoted/promoted user's OWN session must reflect the change on next `/api/auth/me` (R-RBAC-4). Self-deactivation MUST be prevented client-side (an admin must not deactivate their own row — confirm gate warns).

- **Scenario: deactivate other** — GIVEN admin + another user WHEN confirm-deactivate THEN PATCH `{active:false}` and the row shows inactive.
- **Scenario: self-deactivate blocked** — GIVEN the admin's own row WHEN attempting deactivate THEN a localized warning renders and no request fires.

### Requirement: R-UI-JOB-1 — Jobs list (manager+) with server-side filters (delta approved)

The Jobs page MUST render `GET /api/jobs?state=&queue=&page=&limit=` (columns: id, queue, state, attempts, timestamps) — server-side `state`/`queue` filters added by the approved backend delta (jobs `state` enum per pg-boss v12: 6 states; `queue` ≤ 100 chars). The page MUST show a state column with localized labels and the retry action per row. Only manager/admin see the module.

- **Scenario: list** — GIVEN jobs WHEN loaded THEN queue/state/attempts columns render; failed jobs are visually distinct.
- **Scenario: state filter** — GIVEN `?state=failed` WHEN applied THEN only failed rows render (server-side).
- **Scenario: guard** — GIVEN operator WHEN navigating to /jobs THEN redirect + denial toast (no `jobs:job_read`).

### Requirement: R-UI-JOB-2 — Retry job (manager+)

Retry MUST be a confirm-gated action on failed/archived jobs calling `POST /api/jobs/:id/retry`; success → toast "Trabajo reencolado" + row refresh. 404 renders the localized not-found state.

- **Scenario: retry** — GIVEN a dead-lettered job WHEN confirm-retry THEN the API call fires, toast renders, and the row's state refreshes.
- **Scenario: unknown id** — GIVEN a stale row WHEN retry THEN localized 404 renders and the list refreshes.

# 16. i18n & Backend Delta (R-I18N, R-BE) — capstone-ui

System-wide ES/EN i18n (neutral professional Spanish — hard user preference, no voseo/Rioplatense) plus the approved additive backend delta: migration 007 locale columns, bilingual notification templates, self-service locale endpoint, products PATCH, warehouses CRUD, jobs filters, SPA history-fallback serving. Backend contract is otherwise UNCHANGED (locked); the delta is additive and non-breaking.

### Requirement: R-BE-1 — Migration 007: locale columns (additive, idempotent)

Migration `007_locale.sql` MUST add `users.locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en'))` and `notifications.locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en'))`, using `ADD COLUMN IF NOT EXISTS` (idempotent — safe re-run and safe downgrade). Existing rows default to `'es'`; existing notification history keeps its previously rendered English snapshot (rendered content untouched — only the new column is added).

- **Scenario: applies twice** — GIVEN a migrated DB WHEN the migration runs again THEN no error and columns unchanged (idempotent).
- **Scenario: defaults** — GIVEN existing users/notifications after migration THEN `locale = 'es'` on every row.
- **Scenario: check enforced** — GIVEN an INSERT/UPDATE with `locale='fr'` THEN it fails (CHECK).

### Requirement: R-BE-2 — Bilingual template dictionaries with key parity

`backend/src/jobs/templates.ts` MUST expose dictionaries per locale (`es` / `en`) with IDENTICAL key sets per notification type (title + body for all 7 types); `render(type, payload, locale)` MUST select the dictionary by locale (default `'es'`). A parity test MUST assert `Object.keys(es) === Object.keys(en)` (exact same keys, both directions) and that the neutral-Spanish checklist (no voseo/Rioplatense: no "vos", "tenés", "querés", "sos", "tu" imperative voseo forms) holds for every ES template string.

- **Scenario: key parity** — GIVEN the dictionaries WHEN the parity test runs THEN both locales expose exactly the same keys for all 7 types.
- **Scenario: neutral Spanish** — GIVEN every ES template string WHEN checked against the banned-tokens list THEN zero matches.
- **Scenario: render locale** — GIVEN `render(orderConfirmed, payload, 'en')` THEN an English title/body; with `'es'` THEN neutral Spanish.

### Requirement: R-BE-3 — emitEvent renders per recipient locale and stores the snapshot

`emitEvent` MUST resolve each recipient's stored `users.locale` and render the template in that locale at emit time, storing `title`, `body` AND `locale` on the notification row. All recipients of one event keep exactly-once semantics (`ON CONFLICT (type, reference, channel, user_id)`); the email job carries only `notificationId` (worker reads the stored snapshot — never re-renders, R-NOT-5).

- **Scenario: per-recipient locales** — GIVEN a low_stock event with one 'es' and one 'en' recipient WHEN it emits THEN each row renders in its recipient's locale and stores its own `locale`.
- **Scenario: exactly-once preserved** — GIVEN the same event emitted twice WHEN replayed THEN no duplicate rows (existing UNIQUE key still holds) and the locale snapshot is unchanged.

### Requirement: R-BE-4 — Self-service locale: PATCH /api/auth/me {locale} + DTO field

`PATCH /api/auth/me` (auth required) MUST accept `{locale}` validated `'es' | 'en'` (invalid → 422 `VALIDATION_ERROR`), update the caller's `users.locale`, and return the updated `{user}` (PublicUser now includes `locale`). `GET /api/auth/me`, login, refresh and users list MUST include `locale` in their user objects. `POST /api/users` DOES NOT accept `locale` (new users default 'es'; self-service only — locked delta). OpenAPI MUST reflect the new endpoint/field automatically from the zod DTOs (R-DOC-1).

- **Scenario: set locale** — GIVEN an authenticated 'es' user WHEN `PATCH /api/auth/me {locale:'en'}` THEN 200 with `user.locale:'en'` and the DB row updated.
- **Scenario: invalid locale** — GIVEN `{locale:'fr'}` WHEN PATCH THEN 422 and the stored locale unchanged.
- **Scenario: unauthenticated** — GIVEN no token WHEN PATCH THEN 401 (same body as R-AUTH-2).
- **Scenario: dto surface** — GIVEN login/refresh/me/users responses THEN every `user` object includes `locale`.
- **Scenario: docs reflect** — GIVEN the server runs THEN `/api/docs` lists `PATCH /api/auth/me` and the locale field in user schemas (regenerated, no hand-edits).

### Requirement: R-BE-5 — SPA history-fallback serving with /api 404 preserved

The express app MUST serve the Vite build (`ui/dist`) as static assets and MUST fall back to `index.html` for any GET that is NOT under `/api` (client-side routing). Requests under `/api/*` that match no route MUST return the existing JSON 404 (`{error:{code:"NOT_FOUND",...}}`) — the SPA fallback MUST NOT swallow them. Ordering in `app.ts`: API routers → static dist → SPA fallback (non-`/api`) → JSON 404 for `/api` → error handler.

- **Scenario: deep link** — GIVEN `GET /orders/42` (no such static file) WHEN the server handles it THEN 200 + `index.html` (SPA shell).
- **Scenario: api 404 preserved** — GIVEN `GET /api/does-not-exist` WHEN the server handles it THEN JSON 404 (NOT index.html).
- **Scenario: static asset** — GIVEN `GET /assets/index-abc.js` (exists in dist) WHEN handled THEN the file serves with 200 (static middleware wins over fallback).
- **Scenario: dev parity** — GIVEN the Vite dev server proxy (`/api` → :3000) THEN the same 404 JSON arrives for unknown `/api/*` (no CORS; same-origin).

### Requirement: R-I18N-1 — UI dictionary key parity (es ≡ en)

The UI dictionaries (`src/i18n/es.ts`, `src/i18n/en.ts`, homegrown const objects — no i18next) MUST expose IDENTICAL key sets: `MessageKey = keyof typeof en` and a parity test MUST assert `Object.keys(es)` equals `Object.keys(en)` (exact, both directions) — compile-time via the type, runtime via the test. Every UI string (shell, modules, validation messages, error mappings, toasts, states) MUST live in the dictionaries; no hardcoded user-facing literals outside them.

- **Scenario: parity green** — GIVEN both dictionaries WHEN the parity test runs THEN key sets are identical.
- **Scenario: missing key is a compile error** — GIVEN a component uses a key absent from `en` THEN `tsc` fails (type-driven).

### Requirement: R-I18N-2 — Neutral Spanish (hard user preference)

All ES strings (UI + templates + emails) MUST be neutral professional Spanish: NO voseo, NO Rioplatense/Argentine expressions ("vos", "tenés", "querés", "sos", "andá", "che", "dale"), formal "usted"/impersonal constructions allowed, consistent "tú"-free register. A banned-token test (R-I18N-2 scenario) MUST scan UI dictionaries AND backend template dictionaries; the checklist is enforced at review for strings the scanner cannot catch (tone/register).

- **Scenario: banned tokens scan** — GIVEN the ES dictionary files (UI + backend templates) WHEN scanned for the banned-token list THEN zero matches.
- **Scenario: register review** — GIVEN every ES string reviewed against the neutral checklist during apply THEN no voseo forms are introduced (design-critic passes the strings).

### Requirement: R-I18N-3 — Toggle behavior, persistence, default

The language toggle MUST switch the ENTIRE app (all modules, forms, toasts, states, error messages, date/number formatting) and set `document.documentElement.lang`. Default locale is `'es'` (locked). Persistence: pre-auth → localStorage only (no backend call); post-auth → `PATCH /api/auth/me {locale}` (R-BE-4) AND localStorage, with the backend value winning on boot (`/api/auth/me` locale overrides localStorage when they differ). The switch MUST re-render the whole tree without a page reload.

- **Scenario: default es** — GIVEN a fresh visitor (no stored locale) WHEN the app boots THEN the UI renders in ES and `document.lang === 'es'`.
- **Scenario: pre-auth toggle** — GIVEN an unauthenticated user WHEN toggling to EN THEN localStorage stores 'en', UI re-renders in EN, and NO API call fires.
- **Scenario: post-auth sync** — GIVEN an authenticated user toggling to EN WHEN the switch completes THEN `PATCH /api/auth/me {locale:'en'}` fires and the header user chip shows 'en'.
- **Scenario: backend wins on boot** — GIVEN localStorage 'en' but `user.locale:'es'` WHEN the app restores the session THEN the UI renders in ES and localStorage is corrected to 'es'.

### Requirement: R-I18N-4 — Localized API error mapping

A `localizeError` mapping MUST translate backend error codes to localized friendly messages: `UNAUTHORIZED` → "Sesión expirada, inicia sesión de nuevo" / "Session expired, please sign in again" (refresh flow path); `FORBIDDEN` → "No tienes permiso para esta acción" / "You do not have permission"; `NOT_FOUND` → per-resource messages; `CONFLICT` subcodes (`USERNAME_TAKEN`, `DUPLICATE_EMAIL`, `DUPLICATE_SKU`, `INVALID_STATE`, `INSUFFICIENT_STOCK`, `NEGATIVE_STOCK`, `WAREHOUSE_IN_USE`) → specific localized strings (used by R-UI-CRM/R-UI-STK/R-UI-ORD scenarios); `VALIDATION_ERROR` → field-level messages; `INTERNAL_ERROR` → "Ocurrió un error inesperado" / "An unexpected error occurred". Unknown codes MUST fall back to a generic localized message; raw server messages MUST NOT be shown to users.

- **Scenario: conflict mapping** — GIVEN an API error `{code:"INSUFFICIENT_STOCK"}` WHEN `localizeError` runs with 'es' THEN the neutral Spanish stock message returns.
- **Scenario: unknown code** — GIVEN `{code:"SURPRISE"}` WHEN mapped THEN the generic localized fallback returns (never the raw message).
- **Scenario: parity** — GIVEN the error map in both locales THEN the same code sets exist in each (key parity, R-I18N-1).

# API Contract (surface, error, pagination)

## Resource surface (method, path, body, permission)

| Method | Path | Body / notes | Permission |
|---|---|---|---|
| POST | /api/auth/login | `{username,password}` → `{user,accessToken}` + refresh cookie | public |
| POST | /api/auth/refresh | cookie → new access + rotated cookie | public (cookie) |
| POST | /api/auth/logout | cookie → 204 | auth |
| GET | /api/auth/me | → `{user}` (includes `locale`) | auth |
| PATCH | /api/auth/me | `{locale:'es'\|'en'}` → `{user}` (self-service locale) | auth |
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
| PATCH | /api/products/:id | `{name?,sku?,lowStockThreshold?,active?}` (≥1 field) | stock:product_manage |
| GET | /api/warehouses | paginated | stock:stock_read |
| POST | /api/warehouses | `{name}` | stock:product_manage |
| PATCH | /api/warehouses/:id | `{name}` → 200 (409 duplicate name) | stock:product_manage |
| DELETE | /api/warehouses/:id | → 204 (409 `WAREHOUSE_IN_USE` if referenced by a movement) | stock:product_manage |
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

All errors: `{error:{code,message}}`. Codes: `VALIDATION_ERROR` 422 · `UNAUTHORIZED` 401 (identical body everywhere) · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 with subcodes `USERNAME_TAKEN`, `DUPLICATE_EMAIL`, `INVALID_STATE`, `INSUFFICIENT_STOCK`, `NEGATIVE_STOCK`, `DUPLICATE_SKU`, `WAREHOUSE_IN_USE` · `INTERNAL_ERROR` 500 (generic, no internals leaked). Idempotency replays return 200/201 with the original resource, never an error.

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
- RED first (test fails with no implementation) → GREEN → TRIANGULATE (edge cases) → REFACTOR; evidence appended to `docs/output-it<N>.txt` / `docs/output-ui-it<N>.txt`.
- Frontend (capstone-ui): vitest + React Testing Library + jsdom + user-event in `ui/`; the mocked fetch client is the single seam (contract-tested against the OpenAPI/DTO shapes) — unit tests NEVER hit a live backend; every test name prefixed `R-XXX-N:`; the requirement-ID coverage scan (R-UI-NFR-6) enforces that every requirement ID appears in ≥1 test name; Playwright e2e deferred (locked).
- Concurrency tests (R-ORD-5, R-STK-5) run against real Postgres 16 (docker-compose), not mocks.
- SMTP assertions use mailpit; money assertions compare exact strings, never floats.

# Open items for design phase (spec-level decisions flagged)

1. `UNKNOWN_PRODUCT` on order create: 422 vs 409 (design confirms; spec allows either but must be consistent).
2. Notification recipient targeting rules (per type) — matrix channels locked, recipients open.
3. Same-tx pg-boss enqueue mechanism (pg-boss `send` inside tx vs post-commit enqueue + unique key) — the exactly-once contract is locked; mechanism is design's choice.
4. `low_stock` re-notification on each crossing movement (dedupe window) — v1 notifies per crossing event; dedupe is post-v1.
5. `/api/status` exposure: any authenticated user (locked in R-OBS-2) — confirm no stricter need.