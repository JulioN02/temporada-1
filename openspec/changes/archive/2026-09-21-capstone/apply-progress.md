# Apply Progress: CAPSTONE

Change: `capstone` · Project: `temporada-1` · Phase: **apply** · Artifact: hybrid
Repo: `business-operations-platform` · STRICT TDD · Cumulative progress log (Batch A → Batch B).

---

## Batch A (F-1..F-9 + T-1-1..T-1-8) — COMPLETE (2026-09-19)

- **Tests**: 63 tests, 63 passed, 0 failed · **Typecheck**: `tsc --noEmit` clean
- **Evidence**: `docs/output-it1.txt` (setup + suite counts + 16 requirement IDs)
- **DB**: compose `bop-db` (postgres:16-alpine, 55437), migrations 001_rbac + 006_audit on `bop_test`, idempotent via `_migrations`

### Batch A tasks (all [x] in tasks.md)
F-1 monorepo scaffold · F-2 backend deps + strict tsconfig (nodemailer deferred → it5) · F-3 env zod fail-fast · F-4 pool + withTransaction + migrate.ts · F-5 docker-compose + test DB · F-6 logger/errorHandler/validate/requestLogger · F-7 006_audit + writeAudit · F-8 test harness (createTestContext, 5-role factory) · F-9 evidence script · T-1-1 001_rbac (5 roles, 19 perms) · T-1-2 permissions registry + parity · T-1-3 auth repository · T-1-4 auth service (identical 401, rotation, reuse detection) · T-1-5 auth/users routes · T-1-6 requireAuth/requirePermission/app.ts/server.ts · T-1-7 auth+users integration tests + security scans · T-1-8 /api/health

### Batch A deviations (context for it6 scans + reviewers)
1. 19 permissions, not 18 (design/tasks miscount; parity test enforces 19).
2. No `role_permissions` table — per-request check = DB role lookup + TS registry matrix.
3. `refresh_tokens` table added to 001_rbac (R-AUTH-4/5 need it; absent from design §6).
4. Logger redact list extended beyond design floor (exact token/smtp keys for R-NFR-2/R-NOT-3).
5. nodemailer not installed (T-5-3 checkpoint gates it).
6. Error wire shape exactly `{error:{code,message}}`, no details field.
7. All 5 roles assignable via POST /api/users (admin-only endpoint; not an escalation).
8. `user_invited` email job deferred to it5 (S4).

---

## Batch B (T-2-1..T-2-5 + T-3-1..T-3-7) — COMPLETE (2026-09-20)

## Result

- **Tests**: 119 tests, 119 passed, 0 failed (`node --test --test-concurrency=1 "tests/**/*.test.ts"`)
  (63 from Batch A + 17 crm + 19 orders + 5 stock + 8 decimal + 3 orderState + 4 migrate it2/it3 = 119)
- **Typecheck**: `tsc --noEmit` — 0 errors (strict: noUncheckedIndexedAccess, exactOptionalPropertyTypes, erasableSyntaxOnly)
- **Evidence**: `docs/output-it2.txt` + `docs/output-it3.txt` (real suite output, 28 requirement IDs)
- **DB**: migrations 002_crm + 002b_stock_catalog + 003_orders applied to `bop_test` (idempotent via `_migrations` ledger)

## Completed tasks

- [x] T-2-1 migration 002_crm (customers, CITEXT UNIQUE email → 23505 → 409, status CHECK)
- [x] T-2-2 modules/crm/repository.ts (parameterized CRUD + ILIKE substring search + status filter + 2-query pagination)
- [x] T-2-3 modules/crm/service.ts (dup-email 409, 404, writeAudit same-tx; R-CRM-5 rollback parity)
- [x] T-2-4 modules/crm/{dto,controller,routes}.ts (POST/GET/GET:id/PATCH /api/customers, perms per matrix, controllers ≤15 lines)
- [x] T-2-5 tests/integration/crm.test.ts (17 its: R-CRM-1..5 + R-AUTH-8 + R-NFR-1 + R-NFR-6) + evidence output-it2.txt
- [x] T-3-1 migrations 002b_stock_catalog (products/warehouses — SEE DEVIATION #1) + 003_orders (orders + order_items, FK → products)
- [x] T-3-2 lib/decimal.ts + tests/unit/decimal.test.ts (8 its: exact string math, R-ORD-2)
- [x] T-3-3 modules/orders/repository.ts (create w/ lines, list filters + pagination, detail ≤2 queries)
- [x] T-3-4 modules/orders/service.ts (pure status machine, D13 totals, create idempotency R-ORD-4, cancel reason ≥10)
- [x] T-3-5 modules/orders/{dto,controller,routes}.ts (POST/GET/GET:id + confirm|cancel STATE-ONLY per S5; UNKNOWN_PRODUCT/UNKNOWN_CUSTOMER 422 ADR-1)
- [x] T-3-6 modules/stock/* (products/warehouses CRUD only, R-STK-8; product_manage/stock_read perms)
- [x] T-3-7 tests/integration/orders.test.ts (19 its: R-ORD-1..4, R-ORD-7 + replay + exact money) + tests/integration/stock.test.ts (5 its) + evidence output-it3.txt

## Requirement IDs covered (28, cumulative)

R-AUD-1..3, R-AUTH-1..8, R-CRM-1..5, R-NFR-1, R-NFR-2, R-NFR-5, R-NFR-6, R-OBS-1, R-ORD-1..4, R-ORD-7, R-PROD-5, R-STK-8

## Deviations / notes (reported, not silent)

1. **Migration file `002b_stock_catalog.sql` instead of `004_stock.sql (partial)`** — the migrate runner applies `src/db/sql/*.sql` in sorted filename order and `order_items.product_id` FKs to `products`. Products/warehouses MUST exist BEFORE 003_orders, so they cannot live in 004_stock.sql (which sorts after 003). The file `004_stock.sql` stays FREE for the it4 ledger (T-4-1 creates it fresh) — because the runner tracks applied files by name in `_migrations`, extending an already-applied file would never re-run on persistent DBs. This is a file-layout delta; the tables themselves match design §6 exactly.
2. **`confirm_idempotency_key` column created but unused in it3** — reserved for it4 (R-ORD-5 idempotent replay). Confirm endpoint is state-only per S5; the column is schema-ready.
3. **`GET /api/products` added (R-STK-8 surface)** — spec's stock section lists `GET /api/products` under stock_read; implemented with q filter + pagination to make products seedable/verifiable for orders tests.
4. **Warehouse duplicate name → 409 `CONFLICT`** (no subcode) — the closed 409 subcode list (spec error contract) has no warehouse-specific code; generic CONFLICT used for the UNIQUE violation.
5. **`idRef` DTO accepts number or numeric string → canonicalized to string** — BIGSERIAL ids are int8; pg returns them as strings. Accepting both forms keeps the API ergonomic without float coercion.
6. **No `orders:order_*` audit rows in it3** — spec R-AUD covers audit; order confirm/cancel audit rows land with the atomic composition at it4 (T-4-6) per §3.1 step 6. CRM mutations DO write audit (R-CRM-5, same-tx, proven).
7. **Cancel endpoint returns 200** (not 204) — spec table says `POST /api/orders/:id/cancel {reason} → 200`; returns the updated order like confirm.

## Next batch (C)

it4 stock ledger + atomic order→stock showpiece (T-4-1..T-4-9): extend with NEW `004_stock.sql` (movements + view + trigger — file is free, see deviation #1) + `005_notifications.sql`; rewrite `orders.service.confirm` as the §3.1 atomic composition (T-4-6); concurrency tests vs real Postgres. Review-critical.
---

## Batch C (T-4-1..T-4-9) — COMPLETE (2026-09-21)

## Result

- **Tests**: 157 tests, 157 passed, 0 failed (`node --test --test-concurrency=1 "tests/**/*.test.ts"`)
  (119 from Batches A+B + 6 lowStockRule + 4 migration-level + 15 stock ledger + 9 atomic orders + 4 concurrency = 157)
- **Typecheck**: `tsc --noEmit` — 0 errors (strict: noUncheckedIndexedAccess, exactOptionalPropertyTypes, erasableSyntaxOnly)
- **Evidence**: `docs/output-it4.txt` (real suite output, 38 requirement IDs, atomic demo commands)
- **DB**: migrations 004_stock (movements + stock_levels view + immutability trigger) + 005_notifications applied to `bop_test`; unique-constraint ALTER applied manually to bop_test (see deviation #2)

## Completed tasks

- [x] T-4-1 migrations 004_stock.sql (movements ledger, sign/type coherence CHECK, UNIQUE idempotency_key, immutability trigger, stock_levels view, indexes) + 005_notifications.sql (7-type CHECK, channel CHECK, delivery_state, UNIQUE(type,reference,channel,user_id))
- [x] T-4-2 modules/stock/repository.ts — movement insert under pg_advisory_xact_lock (product-keyed, ascending id order, deadlock-free), inline SUM currentStock (sees uncommitted rows), zero-filled getStock via view, newest-first listMovements, defaultWarehouseId (see deviation #1)
- [x] T-4-3 modules/stock/events.ts — low-stock choke point (ADR-5): fires iff sign=-1 AND newLevel < threshold; emits low_stock rows in-tx for active manager+operator; 6 unit tests (crossing / not-crossing / already-low / boundary / positive / zero-threshold)
- [x] T-4-4 modules/stock/service.ts — adjust (negative-stock invariant under lock → 409 NEGATIVE_STOCK, level unchanged), transfer (2 rows same tx, from≠to 422 DTO, source sufficiency → 409 NEGATIVE_STOCK), idempotent replay (R-STK-6), same-tx audit
- [x] T-4-5 modules/stock/{dto,controller,routes}.ts — POST /api/stock/movements (stock_adjust), POST /api/stock/transfers (stock_transfer), GET /api/stock + GET /api/stock/movements (stock_read); controllers ≤15 lines
- [x] T-4-6 modules/notifications/emit.ts (S3 minimal in-tx emit, in-app rows only; ADR-4 recipients) + orders.service.confirm rewritten as THE ATOMIC COMPOSITION (design §7): lock order FOR UPDATE → state check + idempotent replay → lock products ASC + sufficiency → order_out movements + low-stock choke → markConfirmed + key → audit (movementIds) → emitEvent; cancel writes audit order.cancel with reason, never reverses stock (R-ORD-6)
- [x] T-4-7 integration tests: stock.test.ts (15 its: R-STK-1..4,6,7,8 + perms) + orders-atomic.test.ts (9 its: R-ORD-5 happy/insufficient/partial/insert-failure-500-replay + R-ORD-6 + R-STK-7 order_out crossing)
- [x] T-4-8 concurrency tests vs real Postgres: tests/concurrency/stockMovements.test.ts (R-STK-5: 4×+5 → 20 no lost update; stock 2 + 5×−1 → 2×201/3×409, level 0) + orderConfirm.test.ts (R-ORD-5: concurrent confirms one 200 one 409, 1 movement set; adjust-vs-confirm one wins, never negative). No timing sleeps — deterministic advisory-lock interleavings.
- [x] T-4-9 evidence docs/output-it4.txt (iteration summary + atomic demo commands + real suite output: 157 tests, 38 req IDs)

## Requirement IDs covered (38, cumulative)

R-AUD-1..3, R-AUTH-1..8, R-CRM-1..5, R-NFR-1, R-NFR-2, R-NFR-5, R-NFR-6, R-NOT-2, R-OBS-1, R-ORD-1..7, R-PROD-5, R-STK-1..8

## Deviations / notes (REPORTED — decide nothing silently)

1. **Order fulfilment warehouse convention (design gap)**: orders carry NO warehouse dimension (spec §3.1 / design §7) but movement rows require warehouse_id NOT NULL. Resolved with the lowest-id warehouse as the fulfilment point (`stockRepo.defaultWarehouseId`) — deterministic, changeable in one place. FLAG for design review: if orders should be warehouse-parametric, that is a schema change (orders.warehouse_id) for a later iteration.
2. **005_notifications UNIQUE constraint extended with user_id**: design §6 says UNIQUE(type, reference, channel); R-NOT-1 requires per-user rows and low_stock targets manager+operator (multi-recipient) — the literal constraint made the second recipient's row violate UNIQUE. Applied UNIQUE(type, reference, channel, user_id) = exactly-once PER RECIPIENT per event. Migration file updated (fresh installs) + manual ALTER on bop_test (runner tracks applied files by name — file would not re-run).
3. **it4 emits in-app notification rows only (S3)**: R-ORD-5 asserts rows at it4; email-channel rows + pg-boss enqueue complete at it5 (S4) — emit.ts uses ON CONFLICT (type, reference, channel, user_id) DO NOTHING so it5 replay never duplicates.
4. **Transfer insufficiency → 409 NEGATIVE_STOCK** (not INSUFFICIENT_STOCK): same negative-stock invariant as adjustments (design §6 "validates newLevel ≥ 0 / source sufficiency"); INSUFFICIENT_STOCK stays reserved for order confirm (R-ORD-5). Both subcodes are in the closed 409 list.
5. **Low-stock emission wired at it4** (not deferred to T-5-9): ADR-5 choke point "effects in same tx" + R-STK-7 "each crossing notifies" require rows at it4; T-5-9 then extends emissions (cancel, user_invited, full channel matrix + email).
6. **idRef imported from orders/dto.ts into stock/dto.ts** — shared DTO primitive, avoids duplication; revisit if a shared lib emerges.
7. **orders.test.ts confirm tests updated** for the atomic semantics: seedBase now seeds a warehouse + stock (+10) — the it3 state-only confirms would otherwise 409/422 under the real composition.
8. **R-ORD-5 "email job enqueued" assertion still pending** — completes at it5 (S4, pg-boss wired). Notifications table rows ARE asserted at it4.

## Test-infrastructure discoveries (for future batches)

- pg-pool's `Pool.query` internally calls `pool.connect(callback)` and then `client.query(text, values, callback)`. Any test spy replacing `pool.connect`/`client.query` MUST preserve both promise AND callback signatures or every query hangs silently (see the insert-failure 500 test — the working spy pattern).
- `UNIQUE` violations inside a multi-row insert loop (order confirm with duplicate product lines) surface as 500 + full rollback — acceptable; orders with duplicate product lines are not excluded by the DTO (edge case worth a design note if product-line dedupe is desired).

---

## Batch D (T-5-1..T-5-10, it5 Jobs + Notifications full) — COMPLETE (2026-09-21)

## Result

- **Tests**: 186 passed / 0 failed (157 A+B+C + 29 new: 8 templates/matrix unit, 4 mailer unit, 2 R-NOT-3 isolation scans, 1 R-NOT-6 no-polling scan, 6 notifications integration, 9 jobs integration incl. real worker process + mailpit SMTP)
- **Typecheck**: `tsc --noEmit` clean (strict)
- **Evidence**: `docs/output-it5.txt` (SPIKE findings + real suite output: 186 tests, 49 requirement IDs) + `docs/spike-pgboss-tx.md`
- **Infra**: mailpit service added to docker-compose (SMTP 1025 / UI+API 8025); nodemailer 10.0.10 + @types/nodemailer installed (user checkpoint confirmed — decision #3 real SMTP)

## Completed tasks

- [x] T-5-1 SPIKE (ADR-2): pg-boss v12 Atomic Job Insertion VALIDATED — `boss.send(q, d, {db:{executeSql}})` inside `withTransaction` commits/rolls back with the business tx (positive control: in-tx send returned an id, rollback hid the row). Findings: single-statement schema-qualified insert; stop() closes the boss pool (request path uses a NEVER-STARTED boss on a shared pool adapter); jobs snapshot queue config at insert (create_queue is ON CONFLICT DO NOTHING). docs/spike-pgboss-tx.md.
- [x] T-5-2 jobs/queues.ts (notification.send: retryLimit 5, retryBackoff, retryDelay 1s base, retryDelayMax 60, expireIn 900) + lib/pgBossTx.ts (createDbAdapter, createBossEnqueuer, ensureQueue check-then-create). R-JOB-1.
- [x] T-5-3 jobs/mailer.ts — Mailer interface + nodemailer impl (worker-only; sanitized errors never leak SMTP password; only file importing nodemailer — R-NOT-3 scans). nodemailer installed.
- [x] T-5-4 worker.ts (entrypoint: env → pool → mailer → boss start/migrate → ensureQueue → boot reconciliation ADR-2 → work → SIGTERM/SIGINT graceful shutdown) + jobs/handlers.ts (delivery + idempotent skip + terminal-failure detection per pg-boss canRetry semantics + job.completed/job.failed audit + job_failed emit). R-JOB-2/3/4/5. NOTE: pg-boss v12 has NO onComplete API (removed post-v9) — lifecycle audit adapted: job.created in-tx at enqueue, completed/failed in handler.
- [x] T-5-5 modules/notifications/types.ts (NOTIFICATION_TYPES + NOTIFICATION_TARGETS ADR-3/4 registries, discriminated recipients) + jobs/templates.ts pure fns (user_invited never includes password). Parity tests R-NOT-2 (locked matrix + 005 CHECK ≡ registry) + R-NOT-5.
- [x] T-5-6 modules/notifications/{repository,service,emit}.ts — full emitEvent: in-tx recipient resolution, rows per recipient per channel, ON CONFLICT DO NOTHING RETURNING gates the email enqueue via db adapter + job.created audit (exactly-once, R-NOT-6). Enqueuer threaded through app DI (AppDeps.boss).
- [x] T-5-7 notifications dto/controller/routes — GET /api/notifications (own in-app rows, unreadOnly/page/limit), GET /api/notifications/unread-count, POST /:id/read (owner-scoped 404, idempotent 204). R-NOT-1.
- [x] T-5-8 modules/jobs/* read API — GET /api/jobs (pgboss.job all states — v12 has no archive table), POST /api/jobs/:id/retry (boss.retry with queue resolved from the row). R-JOB-6 (manager+; operator denied).
- [x] T-5-9 emitEvent wired into orders confirm/cancel (creator, both channels), stock low-stock choke (manager+operator, both), auth createUser (user_invited email-only, transactional). R-ORD-5 email-job assertion (S4) complete in orders-atomic.test.ts (2 rows + 1 job + job.created audit).
- [x] T-5-10 integration: notifications.test.ts (6 its R-NOT-1..3,6) + jobs.test.ts (9 its R-JOB-1..6, R-NOT-4 incl. REAL mailpit SMTP + spawned worker process + graceful shutdown) + contract scans (R-NOT-3 isolation, R-NOT-6 no-polling). Evidence docs/output-it5.txt.

## Requirement IDs covered (49, cumulative — R-JOB-1..6 + R-NOT-1..6 added)

R-AUD-1..3, R-AUTH-1..8, R-CRM-1..5, R-JOB-1..6, R-NFR-1, R-NFR-2, R-NFR-5, R-NFR-6, R-NOT-1..6, R-OBS-1, R-ORD-1..7, R-PROD-5, R-STK-1..8

## Deviations (REPORTED — decide nothing silently)

1. **pg-boss v12 has no `onComplete`** (removed after v9; verified in dist types). Lifecycle audit (R-JOB-5) adapted: `job.created` written IN-TX at enqueue time (more atomic than the design's onComplete), `job.completed`/`job.failed` written in the handler. `job_failed` in-app notification emitted on terminal failure from the handler.
2. **retryDelay unit**: design "retryDelay 1000" is ms-flavored; pg-boss v12 retryDelay is SECONDS. Mapped to the design's stated intent "exponential 1s base" → retryDelay: 1, retryBackoff: true, retryDelayMax: 60. R-JOB-1 asserts the config.
3. **No separate archive table**: pg-boss v12 keeps all states (created/retry/active/completed/cancelled/failed) in `pgboss.job`; the jobs API reads that one table ("pgboss.job ∪ archive" collapses).
4. **Queue config immutability**: pg-boss `create_queue` is ON CONFLICT DO NOTHING and jobs snapshot the queue's retry config at insert time. Test helper resets the queue row to production config per test; DLQ tests swap the row BEFORE enqueueing (fast profile retryLimit 1, no backoff). ensureQueue (API) is check-then-create so it never fights a test/worker config.
5. **`dead-letter = failed state`** (design §8) — no separate DLQ queue; failed jobs retained with retry_count evidence and redriven via POST /api/jobs/:id/retry. R-JOB-1/R-JOB-3/R-JOB-6 verified against this model.
6. **createUser now transactional**: user insert + user.create audit (was best-effort) + user_invited emit run in ONE tx (withTransaction when called with a Pool) — stricter R-AUD-2 parity than it1.
7. **In-app API lists in_app rows only** (R-NOT-1 "in-app rows"); email rows remain queryable in DB + evidence (delivery_state).
8. **mailpit added to docker-compose at it5** (dev/test sink; full appliance wiring at T-7-2).
9. **Test harness**: `resetDatabase` now also truncates `pgboss.job` + resets the `notification.send` queue row (production config) per test; `ensurePgbossSchema` installs only the schema (once per process).

## Test-infrastructure discoveries (for future batches)

- pg-boss `work()` handlers receive ARRAYS (batch) — v12 signature; includeMetadata: true gives retryCount/retryLimit for terminal-failure detection (`retryCount >= retryLimit` matches pg-boss `canRetry = retryCount < retryLimit`).
- pg-boss `stop()` closes its pool — a STOPPED boss cannot send (queue-cache lookup uses the boss's own db); the API enqueuer must never be stopped. Pre-start send works only when the boss is backed by a custom pool adapter (SPIKE finding).
- Mailpit list API returns summaries (no Text) — full body via GET /api/v1/message/{ID}.
- Spawning `node --experimental-strip-types src/worker.ts` works for entrypoint smoke tests; SIGTERM → exit 0 proves graceful shutdown.

---

## Batch E (T-6-1..T-6-6 + T-7-1..T-7-8, it6 Audit/Observability/OpenAPI + it7 Production) — COMPLETE (2026-09-21) — FINAL APPLY BATCH

## Result

- **Tests**: 229 passed / 0 failed (186 A+B+C+D + 43 new: 9 audit API/read, 6 status+logs, 6 docs, 4 contract scans R-NFR-3/4/R-DOC-2, 9 production contract scans, 5 UI/R-PROD-7, 2 smoke updates, 2 env R-PROD-5). **63/63 requirement IDs covered** in test names (R-NFR-3 cumulative gate GREEN).
- **Typecheck**: `tsc --noEmit` clean (strict)
- **Evidence**: `docs/output-it6.txt` + `docs/output-it7.txt` (real suite output 229/229 + REAL docker build/compose/appliance demo output) + `docs/evidence/` dashboard (dashboard-pages) + `docs/index.html` stub
- **Docker (real)**: `docker build` EXIT 0; container runs `id -u` = 1000 (non-root, user node); HEALTHCHECK hits /api/health; `docker compose up -d --build` full appliance: api HEALTHY, worker consumes email job (mailpit "Order confirmed" → admin@seed.local), audit trail shows the full atomic chain on the real stack. Appliance stopped after verification (db+mailpit left running for dev).

## Completed tasks (all [x] in tasks.md — 62/62)

- [x] T-6-1 modules/audit/{dto,repository,service,controller,routes}.ts — GET /api/audit (entity/action/from/to/page/limit, newest-first, parameterized 2-query pagination; audit:read = admin+auditor)
- [x] T-6-2 audit integration tests — R-AUD-1 (existing) + R-AUD-3 (login payload actor/outcome/ip only, no credentials — success AND failure) + R-AUD-4 (filter/403/auditor/401/dates/422/pagination — 7 cases)
- [x] T-6-3 observability controller+repository (SQL moved OUT of routes → R-NFR-4 clean) — GET /api/status any-authed {version, uptimeSeconds, db, timestamp, queues} + requestLogger path-capture fix (mounted routers rewrite req.path) + R-OBS-3 log assertions (parseable JSON, no token/password values)
- [x] T-6-4 openapi/registry.ts + extend.ts + docs router — OpenAPI 3.1 from the SAME zod DTOs, /api/docs.json + self-hosted Swagger UI (swagger-ui-dist, offline), money=string pattern, notif enum from NOTIFICATION_TYPES, bearerAuth scheme; 6 R-DOC-1 tests
- [x] T-6-5 contract scans — R-NFR-3 (strict tsconfig flags + 63/63 IDs in test names), R-NFR-4 (controllers no SQL/query, services no runtime express/pg), R-DOC-2 (no static openapi.json in src/)
- [x] T-6-6 evidence docs/output-it6.txt (canonical suite section 229/229, 63 IDs)
- [x] T-7-1 Dockerfile multi-stage (build: npm ci + tsc gate; runtime: npm ci --omit=dev, USER node, EXPOSE 3000, HEALTHCHECK /api/health) + .dockerignore + R-PROD-1 contract scan + REAL build + container run (id -u 1000)
- [x] T-7-2 docker-compose.yml full appliance (db → migrate one-shot (SQL + ensure-queues bootstrap — PROD BOOT RACE FIX) → api+worker same image + mailpit) + R-PROD-2 scans + REAL compose up verification + full demo (login → product/stock → order → confirm → notification → SMTP via worker → audit chain). Worker healthcheck disabled (no HTTP surface; deviation noted).
- [x] T-7-3 .github/workflows/ci.yml — push/PR: npm ci → compose db → migrate --db=test → tsc → node --test → docker build → GHCR publish (main + v*, secrets.GITHUB_TOKEN only) + R-PROD-3 scan
- [x] T-7-4 .github/workflows/cd.yml (v* + workflow_dispatch → GHCR tag+latest) + docs/deploy-oracle.md runbook (pull → .env → compose up → backup pg_dump → rollback; exact commands) + R-PROD-4 scans
- [x] T-7-5 ui/index.html + app.js (vanilla, tokens in memory, login + customers/products/stock/orders/confirm + notifications + audit views) served by API at / (express.static, path-resolved) + R-PROD-7 tests (assets + full UI data contract flow incl. confirm → notification appears) + smoke test updated (GET / → UI, was 404)
- [x] T-7-6 env pass — R-PROD-5 server-exit test (short JWT_SECRET → non-zero exit, var named, value never echoed) + .env.example completeness (11 vars, secrets blank)
- [x] T-7-7 evidence docs/output-it7.txt (suite + real docker/appliance output) + docs/evidence/index.html dashboard (iterations 1-7 green + relative links, zero CDN, runtime test-count fetch) + docs/index.html stub → ./evidence/ + R-PROD-6/8 tests
- [x] T-7-8 repo naming readiness — root package.json name business-operations-platform (was already), README flagship (stack/quickstart/module map/evidence/runbook links). **NO git operations, NO repo creation (deferred to orchestrator/user per batch instructions).** Added backend/scripts/seed.ts (dev-demo role users, design tree scripts/seed.ts).

## Requirement IDs covered (63/63 — R-NFR-3 cumulative gate GREEN)

R-AUD-1..4, R-AUTH-1..8, R-CRM-1..5, R-DOC-1..2, R-JOB-1..6, R-NFR-1..6, R-NOT-1..6, R-OBS-1..3, R-ORD-1..7, R-PROD-1..8, R-STK-1..8

## Deviations (REPORTED — decide nothing silently)

1. **pg-boss v12 has NO ping()** (ADR-6 said `boss.ping()`): `queues` implemented as a bounded (500ms) SQL ping of `pgboss.queue` via the shared pool — schema/queue missing or DB down → "down". Same signal, never blocks (verified in dist types; removed after v9).
2. **zod v4 + zod-to-openapi v9 dual-build discovery**: the package has no `exports` field → NodeNext resolves the CJS build which patches the CJS zod copy; this project's schemas are ESM-zod. Fixed by importing the bundled dist/index.mjs (ambient d.ts) + a bootstrap module (src/openapi/extend.ts) imported BEFORE any DTO module — zod v4's `$constructor` copies methods at instance creation, so extendZodWithOpenApi must run before schema creation (hence the first-import in app.ts). Documented in zod-to-openapi-esm.d.ts + extend.ts.
3. **requestLogger path fix**: mounted routers rewrite req.url → req.path at response-finish was router-relative (/status); path now captured at request start (R-OBS-3 asserts the full path).
4. **GET /api/stock response envelope is `{items}`** (Batch C contract, not {data,pagination}) — UI, OpenAPI (StockLevelList) and tests consume that shape; noted in code comments.
5. **Worker healthcheck disabled in compose** (healthcheck.disable: true): the image HEALTHCHECK fetches the API port; the worker has no HTTP surface. Restart policy covers crashes.
6. **Seed admin**: the appliance has no admin (R-AUTH-1: no self-registration) — added backend/scripts/seed.ts (dev-only, documented DEMO ONLY; runbook creates real users via POST /api/users). Not wired into the migrate one-shot (would bake known credentials into prod flows).
7. **R-PROD-1/2 suite tests are static contract scans** (fast, deterministic CI); the REAL docker build + non-root run + full compose up + worker-consumes-SMTP verification were executed in this batch with real output in docs/output-it7.txt (docker IS available locally; CI also runs docker build as a workflow step).
8. **T-7-8 adjusted scope**: repo creation/push/ghcr verification explicitly deferred (batch instruction — no git operations). Naming readiness (package.json + README) done; R-PROD-8 "repository named" contract covered by the package-name test.
9. **R-PROD-7 browser rendering not tested** (no browser in suite): the UI's exact data contract is exercised end-to-end at API level (login → lists → confirm → notification appears) + static assets asserted; actual DOM rendering is verified by the human demo at localhost:3000.

## Test-infrastructure discoveries (for verify phase)

- zod 4.6.5 classic is class-less: `ZodType.prototype` patching affects only schemas created AFTER the patch (per-instance method copying via core.$constructor). Any future .openapi() usage must go through src/openapi/extend.ts import order.
- The evidence script appends canonical sections; the it6/it7 docs were bootstrapped (files must exist for R-PROD-6 to pass), then regenerated — each doc now has ONE canonical green section + iteration summary.
- `docker compose up -d --build` reuses the dev db/mailpit containers (bop-db/bop-mailpit) — the appliance is additive, not destructive.
