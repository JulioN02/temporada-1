# Verification Report: CAPSTONE — Business Operations Platform

Change: `capstone` · Project: `temporada-1` · Phase: **verify** · Artifact store: **hybrid**
Date: 2026-09-21 · Mode: **STRICT TDD** (node --test runner, real Postgres 16 + mailpit)
Repo: `business-operations-platform` · Upstream: spec.md (63 reqs) · design.md (13 ADRs) · tasks.md (62 tasks) · apply-progress.md (batches A–E)

**Verdict: PASS WITH WARNINGS** — implementation is behaviorally compliant with the spec (229/229 green, tsc clean, 63/63 requirement IDs covered, real appliance verified). All 15 reported deviations accepted; 1 non-blocking process WARNING + 4 SUGGESTIONs recorded.

---

## 1. Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 62 |
| Tasks complete | 62 |
| Tasks incomplete | 0 |
| Batches | A (F+it1), B (it2+it3), C (it4), D (it5), E (it6+it7) — all COMPLETE |
| Requirement IDs | 63/63 (independently reproduced scan, see §5) |

## 2. Build & Tests — REAL EXECUTION (run by verify, 2026-09-21)

**Typecheck**: `npx tsc --noEmit` → **EXIT 0**, zero errors (strict: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `noEmit` — confirmed in tsconfig + R-NFR-3 test).

**Tests**: `npm test` (backend) → **229 tests, 229 passed, 0 failed, 0 skipped, exit 0** (313s).
Runner: `node --test --test-concurrency=1 "tests/**/*.test.ts"` with `pretest` migrate to real Postgres 16 (`bop_test`, container bop-db:55437) + real mailpit SMTP sink.

```
ℹ tests 229
ℹ suites 52
ℹ pass 229
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 313251.477546
TEST_EXIT=0
```

**Coverage**: not available (no coverage tool configured — spec has no coverage gate; explicitly out of scope). Reported as skipped per protocol, NOT a failure.

**Evidence docs vs real run**: `docs/output-it1..7.txt` cumulative suite sections read and cross-checked: 63 → 119 → 119 → 157 → 186 → 229 → 229. **The it6/it7 canonical sections (229/229) exactly match this verify's real run.** it7 additionally contains REAL docker output: `docker build` EXIT 0, `id -u` = 1000 (non-root, user node), `docker compose ps` shows bop-api Up (healthy), bop-db healthy, bop-mailpit healthy, bop-worker Up, curl checks (health 200, UI 200, /api/docs 200, /api/docs.json 200), appliance demo (confirm-order → mailpit message → audit chain).

## 3. TDD Compliance (Step 5a — strict)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ (non-standard format) | apply-progress has per-batch RED→GREEN results + real counts + per-task test-file references, but NO formal "TDD Cycle Evidence" table (RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR columns) |
| All tasks have tests | ✅ | every task maps to a test file that EXISTS (spot-verified across all 4 layers) |
| RED confirmed (tests exist) | ✅ | all task-referenced test files verified present (e.g. auth.test.ts, orders-atomic.test.ts, orderConfirm.test.ts, no-polling.test.ts, mailer-isolation.test.ts, contract-scans.test.ts) |
| GREEN confirmed (tests pass) | ✅ 229/229 | real execution, exit 0 |
| Triangulation adequate | ✅ | multiple scenarios per requirement (e.g. R-ORD-5: 7 scenarios across integration + concurrency; R-STK-7: 6 unit cases) |
| Safety Net for modified files | ✅ | cumulative suite green per batch (63→119→157→186→229), evidence docs per iteration |
| Assertion quality (Step 5f) | ✅ | no tautologies, no ghost loops, no smoke-only tests found in spot-audit (auth.test.ts: 51 behavioral assertions; concurrency tests assert final DB state; no `expect(true).toBe(true)` patterns anywhere in scanned files) |

**TDD Compliance**: 6/7 checks passed — the single miss is a FORMAT issue (no canonical TDD table), substance fully present and independently validated by real execution → **WARNING W-1** (not CRITICAL: the module's intent — validating TDD evidence against reality — is completely served).

## 4. Test Layer Distribution (informational)

| Layer | Files | Tests (approx) | Tools |
|-------|-------|----------------|-------|
| Unit | 10 | ~54 | node:test, no DB |
| Integration | 15 | ~152 | supertest vs real Postgres 16 + real mailpit + spawned worker process |
| Concurrency | 2 | 4 | real Postgres, Promise.all (deterministic advisory-lock interleavings, no sleeps) |
| Contract scans | 4 | ~19 | static source scans (R-NFR-2/3/4/5, R-NOT-3/6, R-DOC-2) |
| **Total** | **31** | **229 (authoritative, from real run)** | |

## 5. Requirement Coverage (independently reproduced)

Independent scan (node script over `tests/**/*.test.ts`, matching `it|describe("...R-XXX...")`):

- Spec requirement IDs: **63**
- IDs found in test names: **63** — MISSING: none · EXTRA: none
- **R-NFR-3 cumulative gate: GREEN (confirmed by verify, not just the suite's own test)**

## 6. Spec Compliance Matrix (behavioral — via real test run)

| Module | Requirements | Compliance |
|--------|-------------|-----------|
| Auth/RBAC | R-AUTH-1..8 (8) | ✅ all scenarios pass (identical 401 + dummy bcrypt verified in code, rotation/reuse family-invalidation in one tx `FOR UPDATE SKIP LOCKED`, per-request DB permission check) |
| CRM | R-CRM-1..5 (5) | ✅ (dup-email 409, inactive excluded from default list, same-tx audit, rollback parity) |
| Orders | R-ORD-1..7 (7) | ✅ (D13 exact strings, status machine, idempotent create/confirm replay, atomic §3.1 composition, cancel-no-reversal) |
| Stock | R-STK-1..8 (8) | ✅ (immutable trigger, derived view, negative invariant under advisory locks, transfers, idempotency, event-driven low-stock, catalog) |
| Jobs | R-JOB-1..6 (6) | ✅ (queue config, worker + restart durability, retry/backoff/dead-letter via failed state, idempotent handler, lifecycle audit, read API + manual retry) |
| Notifications | R-NOT-1..6 (6) | ✅ (owner-scoped in-app API, channel matrix parity vs 005 CHECK, worker-only SMTP, mailpit up/down semantics, templates w/o secrets, event-driven exactly-once) |
| Audit | R-AUD-1..4 (4) | ✅ (append-only trigger, same-tx, no credentials — success AND failure login asserted, read API filters/permission) |
| Observability | R-OBS-1..3 (3) | ✅ (health 200/503, status authed 401/200, pino JSON redact asserted) |
| Docs | R-DOC-1..2 (2) | ✅ (OpenAPI from zod at /api/docs + docs.json, no static openapi.json scan) |
| Production | R-PROD-1..8 (8) | ✅ (Dockerfile multi-stage non-root HEALTHCHECK + REAL build evidence; compose appliance + REAL up; CI/CD workflows; runbook; evidence docs + dashboard; UI data-contract e2e; repo naming readiness) |
| NFR | R-NFR-1..6 (6) | ✅ (parameterized SQL, secrets, quality gate, architecture constraints, JWT discipline, no N+1) |

**Compliance summary: 63/63 requirements covered by ≥1 passing requirement-named test; 0 FAILING; 0 UNTESTED.**

## 7. Correctness Spot-Checks (source-level, in addition to tests)

| Contract | Evidence |
|----------|----------|
| ApiError shape `{error:{code,message}}` | errorHandler.ts — uniform, 500 generic, no internals leaked; details never serialized |
| 409 INSUFFICIENT_STOCK zero side effects | orders/service.ts confirm: whole §3.1 composition in one `withTransaction`; tests assert movements=0, notifications=0, audit=0, pgboss.job unchanged |
| Idempotent replay | create (R-ORD-4) + confirm (R-ORD-5, key match → 200) + movements (R-STK-6, ON CONFLICT DO NOTHING) |
| No-enumeration login | auth/service.ts: identical 401 body all branches + dummy bcrypt compare for timing parity |
| Refresh rotation + reuse detection | one tx, FOR UPDATE SKIP LOCKED, revoked row → family invalidation; SHA-256 hashes at rest |
| Append-only audit, no credentials | 006 trigger; write.ts payloads actor/ip only; R-AUD-3 tests assert no password/hash/token fields on success AND failure |
| D13 money | lib/decimal.ts cents-based; `mul('3','0.10')='0.30'`; NUMERIC(13,2) columns; zod scale≤2 → 422 |
| Channel matrix parity | NOTIFICATION_TYPES/NOTIFICATION_TARGETS ≡ spec §6.1 exactly (7 types); parity test vs 005 CHECK |
| Exactly-once enqueue | ON CONFLICT (type,reference,channel,user_id) DO NOTHING RETURNING gates pg-boss send via db adapter in-tx (SPIKE-validated) |
| Cancel does not reverse stock | cancelOrder: no movement writes; audit + order_cancelled only |

## 8. Security Scan (code-auditor lens)

- **Parameterized SQL**: all repositories use `$N` placeholders; dynamic WHERE assemblies (audit, notifications, stock, orders) build only `$N`-placeholder fragments with values passed as params. No user-value interpolation found in any SQL string (verified across modules + contract scans).
- **JWT**: `jwt.verify` + `typ==='access'` + exp enforced in requireAuth; `jwt.decode` appears only in a comment; scan test enforces it.
- **Secrets**: no hardcoded secret literals in src/ (scan passes); logger redact covers authorization/cookie/password/token/smtp* plus practical keys (accessToken, refreshToken, smtpHost/Port/User/Pass/From); request bodies never logged; `JWT_SECRET`/`COOKIE_SECRET` ≥32 zod fail-fast; no `.env` files present, `.gitignore` blocks them, `.env.example` secrets blank.
- **bcrypt**: cost 10 (`BCRYPT_COST = 10`), verified.
- **SMTP creds**: mailer sanitizes errors (test asserts SMTP failure message never contains the password); nodemailer imported by exactly one file (scan).
- **Audit**: never stores credentials (R-AUD-3 asserted both paths).
- **CI/CD**: secrets exclusively `secrets.GITHUB_TOKEN` via stdin; no inlined credentials.

## 9. The 15 Deviation Sign-offs (binding decisions for archive)

| # | Deviation | Verdict | Reasoning |
|---|-----------|---------|-----------|
| 1 | UNIQUE(type,reference,channel) → +user_id | ✅ **ACCEPT** | Design §6 constraint was buggy vs R-NOT-1 (per-user rows) + R-NOT-2 (low_stock → manager+operator multi-recipient): the literal constraint breaks on the 2nd recipient. `UNIQUE(type,reference,channel,user_id)` = exactly-once PER RECIPIENT (R-NOT-6) and satisfies R-NOT-1 owner scope. Verified in 005 SQL + emit.ts + parity tests. Spec is authoritative; design corrected. |
| 2 | defaultWarehouseId (lowest id) for order_out | ✅ **ACCEPT** (SUGGESTION for later) | Spec §3.1/design §7 never defined a warehouse dimension for orders; movement rows require warehouse_id (R-STK-1). Convention is deterministic, documented in code, fails cleanly (422 UNKNOWN_WAREHOUSE when none exists). Not a spec violation — spec was silent. SUGGESTION: `orders.warehouse_id` in a later iteration. |
| 3 | Duplicate product lines → 500 rollback | ✅ **ACCEPT** (SUGGESTION) | R-ORD-1 doesn't forbid duplicate lines; DTO allows them; `order_out:{orderId}:{productId}` collides → UNIQUE → 500 + full rollback (order stays draft, zero side effects — safe). Semantically a client error returning 500 is imprecise. SUGGESTION: DTO-level line dedupe → 422 VALIDATION_ERROR (post-v1). Not a spec violation. |
| 4 | pg-boss v12 no onComplete → R-JOB-5 adapted | ✅ **ACCEPT** | Verified (v12 removed onComplete post-v9). `job.created` in-tx at enqueue is STRONGER atomicity than design's onComplete; `job.completed`/`job.failed` in handler. R-JOB-5 scenario (failed job → created+failed rows with attempts) passes in the suite. Requirement is about the audit trail, not the hook — satisfiable. |
| 5 | retryDelay seconds not ms | ✅ **ACCEPT** | pg-boss v12 `retryDelay` is SECONDS; `retryDelay:1` + `retryBackoff:true` + `retryDelayMax:60` implements the design's stated intent "exponential 1s base". R-JOB-1 (retryLimit≥3, backoff, DLQ) satisfied and asserted. Unit-correctness fix, not intent deviation. |
| 6 | Queue config immutable per row; test harness resets | ✅ **ACCEPT** | `create_queue` is ON CONFLICT DO NOTHING; jobs snapshot config at insert. Test harness resetting the row per test is deterministic; `ensureQueue` check-then-create never fights test config; production config wins (migrate one-shot + worker boot create it first). Sound. |
| 7 | createUser fully transactional | ✅ **ACCEPT** | user + audit + user_invited + job in ONE tx — STRICTER R-AUD-2 parity than it1's best-effort, aligns with R-NOT-6 exactly-once. Improvement, no violation. |
| 8 | Prod boot race → ensure-queues.ts | ✅ **ACCEPT** | Race was real: request-path enqueuer (never-started boss) needs pgboss schema + queue row, which only the worker installed at boot. Fix: compose migrate one-shot runs SQL + `boss.migrate()` + `createQueue` before api/worker (service_completed_successfully). Idempotent. Verified in compose + script + it7 real output. Sound fix. |
| 9 | pg-boss v12 no ping() → SQL ping | ✅ **ACCEPT** | ADR-6's `boss.ping()` doesn't exist in v12. `queues` implemented as bounded 500ms SQL ping of pgboss.queue via shared pool — same signal (infra reachable), never blocks, additive field (ADR-6 said additive). R-OBS-2 locked fields unchanged and passing. |
| 10 | zod v4 dual-build OpenAPI bootstrap | ✅ **ACCEPT** | Class-less zod v4 + zod-to-openapi v9 CJS-patch conflict resolved via ESM bundle import + `extend.ts` imported BEFORE any DTO module (first import in app.ts), documented in zod-to-openapi-esm.d.ts. R-DOC-1/2 pass (docs served 200 + spec JSON with all v1 paths; no static openapi.json). Pattern is safe if import order is preserved. |
| 11 | GET /api/stock `{items}` envelope | ✅ **ACCEPT** (SUGGESTION) | /api/stock is NOT paginated (no page/limit) → pagination envelope contract doesn't apply. `{items}` is documented in code + OpenAPI (StockLevelList) and consumed consistently by UI/tests. Minor stylistic inconsistency with `{data,pagination}` convention elsewhere. SUGGESTION: normalize in a future iteration. |
| 12 | Worker healthcheck disabled in compose | ✅ **ACCEPT** | Image HEALTHCHECK fetches the API port; worker has no HTTP surface by design (R-NOT-3). `healthcheck.disable: true` + `restart: unless-stopped` covers crashes. R-PROD-1 healthcheck requirement applies to the API (which has it, real evidence: bop-api Up (healthy)). Correct. |
| 13 | R-PROD-7 verified at API-contract level | ✅ **ACCEPT** (INFO) | "Frontend tests" are explicitly OUT OF SCOPE (locked decision #2 + spec Scope). UI data contract exercised end-to-end in suite (login → lists → confirm → notification appears) + assets asserted; DOM rendering left to the human demo (documented in it7 evidence). Spec-compliant. INFO: a browser E2E would strengthen it, post-v1. |
| 14 | T-7-8 repo creation deferred | ✅ **ACCEPT** | Explicit user/orchestrator decision (no git ops in apply). Naming readiness complete: package.json name `business-operations-platform`, README flagship. R-PROD-8 covered by package-name test. Outstanding action: create/push repo + GHCR verification post-verify (orchestrator's task). |
| 15 | 19 permissions not 18 | ✅ **ACCEPT** | Independently counted spec §5 matrix = **19 permissions** (3 auth + 3 crm + 4 orders + 4 stock + 2 jobs + 2 notification + 1 audit). Design's "18" was the miscount; implementation matches the SPEC (authoritative). Registry ≡ SQL seeds = 19, parity test enforces it. Fully compliant. |

**Sign-off summary: 15/15 ACCEPTED (0 rejected).** 4 carry SUGGESTION-level follow-ups; 1 is INFO.

## 10. Issues Found

**CRITICAL** (must fix before archive): None.

**WARNING** (should fix):
| ID | Finding | Requirement | Evidence |
|----|---------|-------------|----------|
| W-1 | apply-progress lacks the canonical "TDD Cycle Evidence" table (RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR columns) required by strict-tdd-verify.md Step 5a | process (strict TDD protocol format) | apply-progress.md — substance IS present in distributed form (tasks.md RED annotations per task, per-batch GREEN counts, evidence docs) and independently validated by verify's real 229/229 run; format-only deviation |

**SUGGESTION** (nice to have):
| ID | Finding | Evidence |
|----|---------|----------|
| S-1 | Duplicate order product lines → 500; a 422 `VALIDATION_ERROR` (DTO dedupe) would match client-error semantics | orders/service.ts + Batch C deviation #3 |
| S-2 | `GET /api/stock` `{items}` envelope vs `{data,pagination}` convention elsewhere — normalize later | stock/service.ts:350, openapi/registry.ts:428 |
| S-3 | `defaultWarehouseId` convention: consider `orders.warehouse_id` for warehouse-parametric fulfilment in a later iteration | stock/repository.ts:239 |
| S-4 | Browser E2E for R-PROD-7 (post-v1, per locked scope) would strengthen the UI claim | ui.test.ts (API-contract level only) |

**INFO**:
- Concurrency tests use `Promise.all` against real Postgres with no sleeps (deterministic advisory-lock interleavings) ✅; `jobs.test.ts` uses a bounded 100ms-interval `waitFor` poll for the real worker process — legitimate async-wait, not a race hack.
- `waitFor` polling, mailpit API quirks, pg-boss v12 batch `work()` arrays, and the stop()-closes-pool gotcha are documented as test-infrastructure discoveries in apply-progress — good hygiene.

## 11. Coherence (Design Match)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| ADR-1 UNKNOWN_PRODUCT 422 | ✅ | + parity UNKNOWN_CUSTOMER/UNKNOWN_WAREHOUSE 422 |
| ADR-2 pg-boss same-tx enqueue | ✅ | SPIKE-validated, db adapter; + boot reconciliation safety net |
| ADR-3 matrix const registry + parity | ✅ | NOTIFICATION_TARGETS ≡ 005 CHECK ≡ spec table |
| ADR-4 recipient targeting in-tx | ✅ | creator / invitee / role-based (manager+operator, admin+manager) |
| ADR-5 low-stock choke point | ✅ | sign=−1 AND newLevel < threshold, under product lock, in-tx |
| ADR-6 status + additive queues | ✅ | SQL-ping variant (deviation #9, accepted) |
| ADR-7 5-role RBAC | ✅ | registry + SQL parity; 19 perms (spec-correct, design miscount) |
| ADR-8 D13 string money | ✅ | cents-based exact math, branded DecimalString |
| ADR-9 atomic confirm + no reversal | ✅ | §3.1 composition verbatim; cancel writes audit only |
| ADR-10 appliance | ✅ | multi-stage non-root + HEALTHCHECK; compose db→migrate→api+worker+mailpit; CI/CD→GHCR; runbook |
| ADR-11 pg-boss v12 | ✅ | single queue, no Redis |
| ADR-12 minimal UI | ✅ | vanilla JS served at /, confirm-order flow |
| ADR-13 worker-only SMTP | ✅ | mailer isolation scans (2 tests), nodemailer single-importer |

File tree matches design §5 (all 8 module slices + openapi + jobs + worker + tests/helpers + ui + docs/evidence).

## 12. Verification Evidence (summary)

- `npm test` (backend): **229/229 pass, 0 fail, 0 skip, exit 0** — real Postgres 16 + mailpit, ~5.2 min
- `npx tsc --noEmit`: **exit 0, 0 errors**
- Requirement coverage scan (independent): **63/63 IDs in test names, none missing, none extra**
- Evidence docs cross-check: it1..it7 cumulative counts (63/119/119/157/186/229/229) consistent; it6/it7 canonical sections match this run exactly; it7 contains REAL docker/compose evidence
- Spot security scan: parameterized SQL only, jwt.verify-only, no hardcoded secrets, redact complete, bcrypt cost 10, no .env committed

## 13. Verdict

**PASS WITH WARNINGS** — archive-ready. 62/62 tasks, 63/63 requirements behaviorally proven, 15/15 deviations accepted, real execution evidence recorded. The single WARNING (TDD evidence table format) does not block archive; substance is validated. Apply S-1/S-2/S-3/S-4 to a follow-up iteration; W-1 can be addressed by appending the canonical TDD table to apply-progress during archive if desired.