# Tasks: CAPSTONE — Business Operations Platform (BOP v1)

Change: `capstone` · Project: `temporada-1` · Phase: **tasks** · Artifact: hybrid
Date: 2026-09-19 · Upstream: spec.md (63 reqs) + design.md (13 ADRs) · Downstream: apply
Repo: `business-operations-platform` · STRICT TDD: RED→GREEN→TRIANGULATE→REFACTOR, `node --test`, evidence `docs/output-it<N>.txt` per iteration.

**Sequencing resolutions (binding for apply)**: S1 audit table (006) + `writeAudit` land in Foundation (auth logs login from it1); audit READ API stays in it6. S2 `products`/`warehouses` tables land in it3 (FK from `order_items`); movements/view/trigger stay in it4. S3 migration `005_notifications` + minimal in-tx notification-row insert land in it4 (R-ORD-5 asserts rows); full notifications module + email enqueue in it5. S4 R-ORD-5 "email job enqueued" assertion completes at it5 (pg-boss wired). S5 it3 confirm/cancel = status machine only; it4 replaces confirm with the §3.1 atomic composition.

---

## Foundation Bootstrap (F) — enables everything

- [x] **F-1** Scaffold `capstone/` monorepo: root `package.json` (workspaces backend+ui), `.gitignore`, `.env.example` (secrets blank). Files: `capstone/package.json`. Deps: none. Evidence: `docs/output-it1.txt` setup section. (M)
- [x] **F-2** Backend deps (express 5, pg, pg-boss v12, jsonwebtoken, bcryptjs, zod v4, pino, nodemailer, @asteasolutions/zod-to-openapi v9, swagger-ui-dist) + strict tsconfig (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`). RED: `tsc --noEmit` on probe file fails → GREEN. Files: `backend/package.json`, `backend/tsconfig.json`. (M)
- [x] **F-3** `config/env.ts` zod fail-fast (JWT_SECRET/COOKIE_SECRET ≥32, DATABASE_URL, SMTP_*, APP_VERSION, PG_BOSS_*; no secret echo). Contract R-PROD-5. RED: `env.test.ts` — short secret exits, message names var, never value. Files: `backend/src/config/env.ts`, `tests/unit/env.test.ts`. (M)
- [x] **F-4** `db/pool.ts` + `db/transaction.ts` (`withTransaction`) + `scripts/migrate.ts` (idempotent, `--db=test`) + SQL runner. RED: migrate twice → second no-op. Files: `backend/src/db/*`, `backend/scripts/migrate.ts`. (M)
- [x] **F-5** `docker-compose.yml` (postgres:16-alpine, pg_isready, volume) + test DB wiring. RED: compose up db + `migrate --db=test` green. Files: `capstone/docker-compose.yml`, `tests/helpers/db.ts`. Full appliance later (T-7-2). (S)
- [x] **F-6** `lib/logger.ts` (pino redact `['req.headers.authorization','req.headers.cookie','password','*.token','smtp*']`) + `middleware/errorHandler.ts` (ApiError uniform body) + `validate.ts` (validateDto) + `requestLogger.ts`. RED: `errorHandler.test.ts` uniform `{error:{code,message}}` + 422 convention. Files: `backend/src/lib/logger.ts`, `backend/src/middleware/*`. (M)
- [x] **F-7** Migration `006_audit` (`audit_log` + append-only trigger) + `writeAudit(tx, entry)` helper (S1). Contract R-AUD-1 (early port). RED: direct UPDATE/DELETE on audit_log errors. Files: `backend/src/db/sql/006_audit.sql`, `backend/src/modules/audit/write.ts`. (S)
- [x] **F-8** Test harness: `tests/helpers/testApp.ts` (createApp DI), `users.ts` (5-role factory), `node --test` wired to `npm test`. RED: smoke `GET /` 404s (no routes). Files: `backend/tests/helpers/*`. (M)
- [x] **F-9** Evidence script: append suite counts + requirement IDs to `docs/output-it<N>.txt`. Files: `backend/scripts/evidence.ts`, `docs/output-it1.txt` seed. (S)

## Iteration 1 — Foundation + Auth/RBAC

**Goal**: API boots on strict stack; 5-role RBAC complete (admin-only register, identical-401 login, refresh rotation + reuse detection, per-request DB check); `/api/health` live. **Exit**: `tsc --noEmit` clean, R-AUTH-1..8 + R-NFR-1/2/5 green, `docs/output-it1.txt`.

- [x] **T-1-1** Migration `001_rbac` (roles/permissions/user_roles/users + SQL seed: 5 roles, 18 perms). RED: `migrate --db=test` applies, seed rows exist. Files: `backend/src/db/sql/001_rbac.sql`. Deps: F-4. (M)
- [x] **T-1-2** `permissions/registry.ts` const registry (5 roles × matrix, const-object + mapped union). Contract R-AUTH-7. RED: `permissions.test.ts` — registry ≡ seeded SQL. Files: `backend/src/permissions/registry.ts`, `tests/unit/permissions.test.ts`. Deps: T-1-1. (S)
- [x] **T-1-3** `modules/auth/repository.ts`: users, refresh tokens (SHA-256 hashes only), role lookup, per-request permission check. RED: `R-AUTH-7: missing code → 403`. Files: `backend/src/modules/auth/repository.ts`. (M)
- [x] **T-1-4** `modules/auth/service.ts`: admin-only register (bcrypt cost 10, R-AUTH-1/6), login identical 401 + dummy bcrypt (R-AUTH-2), refresh rotation + reuse detection + family invalidation (R-AUTH-4), idempotent logout (R-AUTH-5). RED: `R-AUTH-4: reused refresh invalidates family`. Files: `backend/src/modules/auth/service.ts`. (L)
- [x] **T-1-5** `modules/auth/{dto,controller,routes}.ts`: POST /api/auth/login|refresh|logout, GET /api/auth/me; POST/GET/PATCH /api/users (admin-only). RED: `R-AUTH-1: non-admin register → 403`. Files: `backend/src/modules/auth/*`. (M)
- [x] **T-1-6** `middleware/requireAuth.ts` (jwt.verify + exp + typ, R-NFR-5) + `requirePermission.ts` (DB check, R-AUTH-8) + `app.ts` createApp DI + `server.ts`. RED: `R-AUTH-8: viewer denied user_create → 403`. Files: `backend/src/middleware/*`, `backend/src/app.ts`, `backend/src/server.ts`. (M)
- [x] **T-1-7** Auth integration tests: `R-AUTH-1..8` + `R-NFR-1` injection inert + `R-NFR-2` redact/env-only scans + `R-NFR-5` verify-scan. RED first. Files: `backend/tests/integration/auth.test.ts`, `users.test.ts`. (L)
- [x] **T-1-8** `modules/observability/routes.ts`: GET /api/health public SELECT 1 → 200/503. Contract R-OBS-1. RED: `R-OBS-1: db up → 200`. Files: `backend/src/modules/observability/routes.ts`. Evidence: `docs/output-it1.txt`. (S)

## Iteration 2 — CRM-lite (first full vertical slice)

**Goal**: customers CRUD/search/status + same-tx audit — complete slice proving the module pattern (routes→controller→service→repository→dto→tests). **Exit**: R-CRM-1..5 green, audit row per mutation, `docs/output-it2.txt`.

- [x] **T-2-1** Migration `002_crm` (`customers`, CITEXT UNIQUE email, status CHECK). RED: migrate applies; dup email rejected at DB. Files: `backend/src/db/sql/002_crm.sql`. Deps: F-4. (S)
- [x] **T-2-2** `modules/crm/repository.ts`: parameterized CRUD + search (q substring ci) + status filter + pagination. RED: `R-NFR-1: injection attempt → empty result, table intact`. Files: `backend/src/modules/crm/repository.ts`. (M)
- [x] **T-2-3** `modules/crm/service.ts`: pure search/status/dup-email rules; `writeAudit` in tx. RED: `R-CRM-1: duplicate email → 409`. Files: `backend/src/modules/crm/service.ts`. (M)
- [x] **T-2-4** `modules/crm/{dto,controller,routes}.ts`: POST/GET/GET:id/PATCH /api/customers; controller ≤15 lines (R-NFR-4). RED: `R-CRM-4: inactive excluded from default list`. Files: `backend/src/modules/crm/*`. (M)
- [x] **T-2-5** CRM integration tests: `R-CRM-1..5` + same-tx audit (R-CRM-5) + `R-NFR-6` list ≤2 queries. Evidence: `docs/output-it2.txt`. Files: `backend/tests/integration/crm.test.ts`. (M)

## Iteration 3 — Orders (status machine, D13 money, idempotent create)

**Goal**: orders + lines; exact string-money totals; status machine; idempotent create; read APIs ≤2 queries; no stock coupling yet (S5). **Exit**: R-ORD-1..4/7 + R-STK-8 (products) green, `docs/output-it3.txt`.

- [x] **T-3-1** Migration `003_orders` (orders + order_items) + products/warehouses tables from 004 (FK dep, S2). RED: migrate applies; FK violation on unknown product. Files: `backend/src/db/sql/003_orders.sql`, `004_stock.sql` (partial). Deps: T-2-1. (M)
- [x] **T-3-2** `lib/decimal.ts` (D13 exact string math) + `decimal.test.ts`. Contract R-ORD-2: `0.10×3="0.30"`, `"12.50"` serialization, scale>2 → 422. RED: unit tests fail on float math. Files: `backend/src/lib/decimal.ts`, `tests/unit/decimal.test.ts`. (S)
- [x] **T-3-3** `modules/orders/repository.ts`: create w/ lines, list (status/customerId filters + pagination), detail order+lines ≤2 queries. RED: `R-ORD-7: detail ≤2 queries (spy)`. Files: `backend/src/modules/orders/repository.ts`. (M)
- [x] **T-3-4** `modules/orders/service.ts`: pure status machine (R-ORD-3), D13 total via decimal.ts, create idempotency-key (R-ORD-4), cancel reason ≥10. RED: `R-ORD-3: confirmed→confirm → 409 INVALID_STATE`. Files: `backend/src/modules/orders/service.ts`. (M)
- [x] **T-3-5** `modules/orders/{dto,controller,routes}.ts`: POST/GET/GET:id /api/orders, POST :id/confirm|cancel (state-only, S5). RED: `R-ORD-1: empty lines → 422`; `R-ORD-1: unknown product → 422 UNKNOWN_PRODUCT` (ADR-1). Files: `backend/src/modules/orders/*`. (M)
- [x] **T-3-6** `modules/stock/*` minimal products/warehouses CRUD (stock:product_manage) to seed products for orders tests. RED: `R-STK-8: create product; dup sku → 409`. Files: `backend/src/modules/stock/{dto,routes,controller,service,repository}.ts` (CRUD only). (M)
- [x] **T-3-7** Orders integration tests: `R-ORD-1..4`, `R-ORD-7` + replay 200 (R-ORD-4) + exact-string money. Evidence: `docs/output-it3.txt`. Files: `backend/tests/integration/orders.test.ts`. (M)

## Iteration 4 — Stock ledger + atomic order→stock (showpiece)

**Goal**: immutable movements + derived view + adjustments/transfers with advisory locks + negative-stock invariant + low-stock choke; order-confirm atomic composition (§3.1) + real-Postgres concurrency proof. **Exit**: R-STK-1..8 + R-ORD-5/6 green, `docs/output-it4.txt`.

- [x] **T-4-1** Extend `004_stock`: movements (CHECK type/quantity/sign, UNIQUE idempotency_key) + immutability trigger + `stock_levels` view + indexes; migration `005_notifications` (UNIQUE(type,reference,channel), S3). RED: `R-STK-1: UPDATE/DELETE blocked`. Files: `backend/src/db/sql/004_stock.sql`, `005_notifications.sql`. (M)
- [x] **T-4-2** `modules/stock/repository.ts`: movement insert under `pg_advisory_xact_lock` (ascending product ids), level via view, idempotency. RED: `R-STK-5: parallel +5 adjustments → level 20`. Files: `backend/src/modules/stock/repository.ts`. (L)
- [x] **T-4-3** `modules/stock/events.ts` low-stock choke point: fire iff sign=−1 AND newLevel < threshold (ADR-5). RED: `lowStockRule.test.ts` — crossing / not-crossing / already-low (R-STK-7). Files: `backend/src/modules/stock/events.ts`, `tests/unit/lowStockRule.test.ts`. (M)
- [x] **T-4-4** `modules/stock/service.ts`: adjustment negative-invariant under lock (R-STK-3), transfer 2 rows same tx from≠to + sufficiency (R-STK-4), reason ≥10. RED: `R-STK-3: below zero → 409 NEGATIVE_STOCK, level unchanged`. Files: `backend/src/modules/stock/service.ts`. (M)
- [x] **T-4-5** `modules/stock/{dto,controller,routes}.ts`: POST /api/stock/movements, /transfers; GET /api/stock, /stock/movements. RED: `R-STK-4: same warehouse → 422`; `R-STK-8: history newest-first`. Files: `backend/src/modules/stock/*`. (M)
- [x] **T-4-6** `modules/notifications/emit.ts` minimal in-tx emit (rows only, S3) + rewrite `orders.service.confirm` as atomic composition: lock order FOR UPDATE → lock products ASC + sufficiency → order_out movements → update confirmed+key → audit → emitEvent (R-ORD-5). RED: `R-ORD-5: insufficient stock → 409, zero movements/notifications/audit`. Files: `backend/src/modules/notifications/emit.ts`, `backend/src/modules/orders/service.ts`. (L)
- [x] **T-4-7** Integration tests: `R-STK-1..4,6,8`; `R-ORD-5` happy path / partial sufficiency / insert-failure 500 rollback / idempotent replay; `R-ORD-6` cancel-no-reversal + audit. Files: `backend/tests/integration/stock.test.ts`, `orders-atomic.test.ts`. (L)
- [x] **T-4-8** Concurrency tests vs real Postgres 16: `R-ORD-5` concurrent confirms (one 200, one 409, 1 movement set); adjust-vs-confirm; `R-STK-5` concurrent negatives (one 409, final ≥0). Files: `backend/tests/concurrency/{orderConfirm,stockMovements}.test.ts`. (L)
- [x] **T-4-9** Evidence: `docs/output-it4.txt` incl. atomic demo commands. (S)

## Iteration 5 — Jobs (pg-boss) + Notifications (full)

**Goal**: durable worker + `notification.send` queue (retry/backoff/DLQ), full notifications module (matrix registry, templates, in-app API, recipient targeting, SMTP worker-only), event-driven triggers, exactly-once; R-ORD-5 email-job assertion completes (S4). **Exit**: R-JOB-1..6 + R-NOT-1..6 green (mailpit), `docs/output-it5.txt`.

- [x] **T-5-1** ⚠️ **SPIKE (ADR-2, do NOT skip)**: validate pg-boss v12 `boss.send(queue, data, {db:{executeSql}})` inside `withTransaction` — prove tx-rollback hides job row; then finalize atomic enqueue contract. RED: spike script asserts rollback → no job visible. Files: `docs/spike-pgboss-tx.md`, scratch `scripts/spike-pgboss.ts` (removed after). Deps: F-4, T-4-6. (M)
- [x] **T-5-2** `jobs/queues.ts` (`notification.send`: retryLimit 5, retryBackoff, retryDelay 1000, expireIn 15min) + `lib/pgBossTx.ts` db-adapter factory. RED: `R-JOB-1: queue exists with retryLimit`. Files: `backend/src/jobs/queues.ts`, `backend/src/lib/pgBossTx.ts`. Deps: T-5-1. (M)
- [x] **T-5-3** ⚠️ **NOTE — nodemailer confirmation (ADR-13)**: user locked REAL SMTP (decision #3); nodemailer is the new dep. **Apply must surface this to the user at it5 start for final confirmation before `npm i nodemailer`.** Build `jobs/mailer.ts` (`Mailer` iface + nodemailer impl, worker-only; request path never imports it, R-NOT-3). RED: mailer spy test — 0 sends in request path. Files: `backend/src/jobs/mailer.ts`. (M)
- [x] **T-5-4** `worker.ts`: boss start → migrate → createQueue → work → onComplete (audit job.created/completed/failed + `job_failed` notif, R-JOB-5) → boot reconciliation (ADR-2) → graceful shutdown. RED: `R-JOB-2: job completes, notification marked sent`; restart durable. Files: `backend/src/worker.ts`, `backend/src/jobs/handlers.ts`. (L)
- [x] **T-5-5** `modules/notifications/types.ts`: NOTIFICATION_TYPES + NOTIFICATION_TARGETS const registries (ADR-3/4) + parity test (R-NOT-2 matrix exact); `templates.ts` pure fns, `user_invited` never includes password (R-NOT-5). RED: `R-NOT-2: matrix parity`. Files: `backend/src/modules/notifications/types.ts`, `backend/src/jobs/templates.ts`, `tests/unit/templates.test.ts`. (M)
- [x] **T-5-6** `modules/notifications/repository+service+emitEvent(tx)`: in-tx recipient resolution + rows per recipient/channel + enqueueEmail via db adapter (exactly-once, R-NOT-6). RED: `R-NOT-2: both channels (creator recipient)`; `R-NOT-2: email only`. Files: `backend/src/modules/notifications/{repository,service,emit}.ts`. (L)
- [x] **T-5-7** `modules/notifications/{dto,controller,routes}.ts`: GET own (unreadOnly/page/limit), POST :id/read owner-scoped 404/204. RED: `R-NOT-1: owner scope → 404`; `R-NOT-1: mark read idempotent`. Files: `backend/src/modules/notifications/*`. (M)
- [x] **T-5-8** `modules/jobs/*` read API: GET /api/jobs (pgboss.job ∪ archive), POST /api/jobs/:id/retry (boss.retry). Contract R-JOB-6. RED: `R-JOB-6: retry dead-lettered → active → processed`. Files: `backend/src/modules/jobs/*`. (M)
- [x] **T-5-9** Wire emitEvent into orders confirm/cancel + stock choke + auth user create (`user_invited`, email-only, R-NOT-2); complete R-ORD-5 happy-path email assertion (S4). RED: `R-NOT-3: no send in request, 1 enqueued job`. Files: `backend/src/modules/orders/service.ts`, `modules/stock/events.ts`, `modules/auth/service.ts`. (M)
- [x] **T-5-10** Integration tests: `R-JOB-1..6` + `R-NOT-1..6` (mailpit up/down: retry→DLQ, delivery_state, R-NOT-4) + `R-NOT-6` no-polling scan. Evidence: `docs/output-it5.txt`. Files: `backend/tests/integration/{jobs,notifications}.test.ts`. (L)

## Iteration 6 — Audit API + Observability + OpenAPI

**Goal**: audit read API, /api/status full, pino request logs w/ redact, OpenAPI generated from zod at /api/docs, all contract scans green. **Exit**: R-AUD-1..4 + R-OBS-1..3 + R-DOC-1..2 + R-NFR scans green, `docs/output-it6.txt`.

- [x] **T-6-1** `modules/audit/{dto,controller,service,repository,routes}.ts`: GET /api/audit (?entity&action&from&to&page&limit, newest-first). Contract R-AUD-4. RED: `R-AUD-4: operator token → 403`. Files: `backend/src/modules/audit/*`. (M)
- [x] **T-6-2** Audit integration tests: `R-AUD-1` trigger block, `R-AUD-2` rollback parity, `R-AUD-3` login payload actor/ip only (no credentials), `R-AUD-4` filter+permission. Files: `backend/tests/integration/audit.test.ts`. (M)
- [x] **T-6-3** `modules/observability/status` route: GET /api/status (any auth, ADR-6): `{version, uptimeSeconds, db, timestamp, queues}` (boss.ping ≤500ms) + `requestLogger.ts` full redact wiring. RED: `R-OBS-2: authed 200 all fields`; `R-OBS-2: unauthenticated → 401`; `R-OBS-3: log line, no token/password values`. Files: `backend/src/modules/observability/*`, `backend/src/middleware/requestLogger.ts`. (M)
- [x] **T-6-4** `openapi/registry.ts`: OpenAPIRegistry from the SAME zod DTOs (R-DOC-1), `/api/docs.json` + Swagger UI via bundled swagger-ui-dist (offline); money = string pattern; notif enum from registry. RED: `R-DOC-1: /api/docs → 200 HTML, spec has all v1 paths`. Files: `backend/src/openapi/registry.ts`, `backend/src/app.ts`. (L)
- [x] **T-6-5** Contract scans: R-NFR-2 secret-literal scan, R-NFR-3 every requirement ID in ≥1 test name + typecheck gate, R-NFR-4 module scan (controllers no SQL, services no express/pg), R-NFR-5 verify-discipline scan, R-NOT-6 no-polling scan, R-DOC-2 no static openapi.json in src/. Files: `backend/tests/contract/*.test.ts`. (M)
- [x] **T-6-6** Evidence: `docs/output-it6.txt` + full-suite rerun (cumulative green). (S)

## Iteration 7 — Production (appliance, CI/CD, UI, docs)

**Goal**: multi-stage Docker non-root + HEALTHCHECK; full compose appliance (db→migrate→api+worker+mailpit+ui); CI/CD → GHCR; minimal verification UI; evidence dashboard; repo `business-operations-platform`. **Exit**: R-PROD-1..8 green, full stack runs offline, `docs/output-it7.txt`.

- [x] **T-7-1** `Dockerfile` multi-stage (build: npm ci + tsc --noEmit → runtime: npm ci --omit=dev, USER node, EXPOSE 3000, HEALTHCHECK fetch /api/health). Contract R-PROD-1. RED: `R-PROD-1: id -u in container ≠ 0`. Files: `capstone/Dockerfile`. (M)
- [x] **T-7-2** `docker-compose.yml` full appliance: db → migrate (one-shot, service_healthy/completed) → api+worker (same image) + mailpit (dev SMTP). Contract R-PROD-2. RED: `R-PROD-2: fresh docker compose up → health green, UI reachable, worker consumes`. Files: `capstone/docker-compose.yml`. (M)
- [x] **T-7-3** `.github/workflows/ci.yml`: push/PR → node 22, npm ci, compose db, migrate --db=test, tsc --noEmit, node --test, docker build, push ghcr.io (main + v*). Contract R-PROD-3. RED: failing test → workflow red, no publish. Files: `.github/workflows/ci.yml`. (M)
- [x] **T-7-4** `.github/workflows/cd.yml` (tag v* → publish GHCR + optional workflow_dispatch) + `docs/deploy-oracle.md` runbook (Oracle Always Free $0: image pull → .env → compose up). Contract R-PROD-4. RED: runbook contains exact commands. Files: `.github/workflows/cd.yml`, `docs/deploy-oracle.md`. (S)
- [x] **T-7-5** `ui/` minimal verification page (static HTML + vanilla JS served by API at `/`): login + customers/orders/stock/notifications lists + confirm-order flow. Contract R-PROD-7, ADR-12. RED: `R-PROD-7: UI login → lists render → confirm → notification appears`. Files: `capstone/ui/index.html`, `app.js`, `backend/src/app.ts` (static mount). (L)
- [x] **T-7-6** Final env pass: `.env.example` complete, zod fail-fast integration test (R-PROD-5 short-secret exit), no-secret-echo verified. Files: `.env.example`, `tests/unit/env.test.ts`. (S)
- [x] **T-7-7** Evidence: `docs/output-it7.txt` (production suite + demo) + `docs/evidence/` dashboard-pages (iterations 1–7 green + links). Contracts R-PROD-6/8. Files: `docs/evidence/index.html`. (M)
- [x] **T-7-8** Repo finalize: create/push `business-operations-platform` (R-PROD-8), verify GHCR package, README (stack, quickstart, runbook link). (S)

---

## Estimation

| Iteration | Tasks | Difficulty mix | Approx lines |
|---|---|---|---|
| Foundation F | 9 | 4S/5M | ~700 |
| it1 auth/RBAC | 8 | 2S/4M/2L | ~1,600 |
| it2 crm | 5 | 1S/4M | ~700 |
| it3 orders | 7 | 1S/6M | ~1,100 |
| it4 stock+atomic | 9 | 1S/4M/4L | ~1,800 |
| it5 jobs/notif | 10 | 3M/7L(→2M) | ~2,200 |
| it6 audit/obs/docs | 6 | 2S/3M/1L | ~1,200 |
| it7 production | 8 | 3S/3M/2L | ~1,100 |
| **Total** | **62** | 14S/32M/16L | **~10,400** |

Difficulty: S = small (≤1 file, ~50-150 lines), M = medium (1-3 files), L = large (cross-module or concurrency/spike, >300 lines). Apply batches: F+it1 as batch A; it2+it3 batch B; it4 batch C; it5 batch D; it6+it7 batch E.

## Review Workload Guard

Total estimated changed lines: **~10,000–11,000** (backend src ~5.5k, tests ~3.5k, infra/ui/docs ~1.5k). One monolithic PR would exceed practical review capacity. **Recommendation: 7 chained PRs, one per iteration** (`it/1`..`it/7` → `main`), each self-reviewable (tsc + suite + evidence doc as merge gate). Largest single PR = it5 (~2,200 lines) — optionally split it5 into `it/5a` (jobs+worker) and `it/5b` (notifications+SMTP) if reviewer bandwidth is a concern. it4 (atomic showpiece) and it7 (infra) are review-critical — schedule dedicated review time.

## Priority / Sequencing (summary)

1. **Foundation F-1..F-9 first** — everything depends on workspace, env, DB, harness.
2. Migrations are additive & ordered: 001 (it1) → 002 (it2) → 003+004-partial (it3) → 004-rest+005 (it4) → 006 (Foundation, S1). Advisory locks in deterministic order throughout (R-STK-5).
3. Auth before any module (all endpoints need requireAuth/requirePermission); audit `writeAudit` available from Foundation (S1); products/warehouses before orders (S2); notifications table + rows before atomic confirm assertions (S3); pg-boss before email (S4).
4. SPIKE T-5-1 gates T-5-2..T-5-10 — do not implement enqueue paths before it concludes.
5. Nodemailer confirmation (T-5-3) is the only user checkpoint inside iterations; everything else is design-locked.