# Verification Report: CAPSTONE-UI — React 19 SPA + system-wide ES/EN i18n + backend delta

Change: `capstone-ui` · Project: `temporada-1` · Phase: **verify** · Artifact store: hybrid
Date: 2026-09-23 · Mode: **Strict TDD** (active — backend `node --test` + frontend vitest/RTL)
Upstream: spec (6 delta files), design (8 ADRs), tasks (48), apply-progress (40 reported deviations, 33 canonical labels) · Downstream: sdd-archive

---

## 1. Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 48 |
| Tasks complete | 48 (`[x]` in tasks.md + apply-progress) |
| Tasks incomplete | 0 |
| TDD evidence reported | ✅ (per-batch TDD Cycle Evidence tables incl. it6 — RED/GREEN/TRIANGULATE/REFACTOR) |

## 2. Real Execution (this verifier ran every gate)

| Gate | Command | Result |
|------|---------|--------|
| Backend suite | `npm test -w backend` (pretest migrate + `node --test --test-concurrency=1`) | ✅ **256/256 pass, 0 fail, 0 skipped** (58 suites; duration 592 047 ms on this machine) |
| UI suite | `npm test -w ui` (vitest run, serial) | ✅ **217/217 pass, 18 files** (0 fail; 385.7 s — machine loaded) |
| Typecheck both | `npm run typecheck` (backend + ui `tsc --noEmit`) | ✅ exit 0, zero diagnostics |
| UI build | `npm run build -w ui` (tsc + vite build) | ✅ exit 0 — initial chunk **132.53 kB gzip** (R-UI-NFR-5 < 250 kB); lazy governance chunks JobsPage 2.60 / AuditPage 2.52 / UsersPage 3.13 kB gzip |
| Docker appliance (live re-confirm) | curl against the **currently running** container | ✅ `/` → React SPA shell (`<div id="root">` + `/assets/index-B4-2G7_F.js`); `/api/docs` → 200; `/orders/42` deep link → 200 (SPA fallback); `/assets/index-B4-2G7_F.js` → 200 (static wins); `/api/does-not-exist` → JSON 404 preserved; `/api/health` → `{"status":"ok","db":"up"}` |

**Requirement coverage: 72/72** — the verifier re-ran the dynamic scan (`R-[A-Z0-9]+(-[A-Z0-9]+)*-[0-9]+` over the 6 spec files): exactly **72 unique requirement IDs**, byte-identical to the pinned list in `ui/tests/nfr.test.ts` (R-UI-NFR-6 test passed in the real run, dynamic path — `openspec/` resolves locally). Drift guard both ways: dynamic scan ⊇ pinned list (72 = 72, 0 missing).

**Evidence-doc fidelity**: `docs/output-ui-it6.txt` real outputs match my runs — vitest 217/217, backend 256/256 (0 fail), build chunk hashes identical (`index-B4-2G7_F.js` 425.86 kB / 132.53 kB gzip), duration differs only by machine load (473 s apply vs 592 s mine). it1–it5 evidence docs + `docs/evidence/index.html` (all 6 UI iterations) present. ✅

**Coverage (per-suite %)**: ➖ Not available — no vitest coverage plugin and no wired `--experimental-test-coverage` in either workspace (skill: informational, not a failure).

## 3. TDD Compliance (Strict TDD module)

| Check | Result | Details |
|-------|--------|---------|
| TDD evidence reported | ✅ | TDD Cycle Evidence tables in apply-progress per batch (it6 verified in `docs/output-ui-it6.txt`) |
| All tasks have tests | ✅ | 48/48 tasks map to test files / infra evidence (docs tasks are evidence-task category) |
| RED confirmed (test files exist) | ✅ | All 21 test files exist (18 UI + backend delta suites) |
| GREEN confirmed (tests pass on execution) | ✅ | 217/217 vitest + 256/256 node --test — run by this verifier |
| Triangulation adequate | ✅ | Multiple cases per behavior (five-role sweep × 13 actions, concurrency tests R-STK-5/R-ORD-5, replay 200-vs-201) |
| Safety net for modified files | ✅ | Reported (e.g. 195/195 before it6 batch); backend 256 stable across batches |

## 4. Test Layer Distribution

| Layer | Tests (approx) | Files | Tools |
|-------|----------------|-------|-------|
| Unit (pure) | ~40 | i18n.test.tsx, formatters.test.ts, api-client.test.ts, mock-fetch.test.ts, nfr.test.ts (scans) | vitest |
| Integration (RTL component/page) | ~177 | auth, rbac, foundation, dashboard, customers, products, warehouses, stock, orders, notifications, audit, users, jobs | vitest + RTL + jsdom + user-event |
| E2E | 0 | — | deferred (locked decision) |
| Backend delta | (in 256) | templates, migrate, auth, notifications, stock, jobs, ui/docs integration | node:test + supertest + real Postgres |

## 5. Assertion Quality (Step 5f scan)

- **Tautologies**: none found. Every `toBe(true/false)` asserts a real predicate (storage scan, request tracking, `isLowStock('3',5)`).
- **Empty-only `toEqual([])`**: only in nfr.test.ts scan assertions (`offenders` arrays) — these FAIL when a violation exists; legitimate.
- **Type-only assertions**: all paired with value assertions (`validateUsername(...).not.toBeNull()` + message checks in the same test).
- **Ghost loops**: none — the five-role sweep iterates a constant 13-item `ACTION_PERMISSIONS` and asserts presence AND absence per item.
- **Mock ratio**: healthy — api-client 16 mocks / 67 expects; auth 7/36; rbac 5/26 (no mock-heavy files).
- **Smoke-only tests**: none — page tests assert rendered rows/data, not just `toBeInTheDocument()`.

**Assertion quality**: ✅ All assertions verify real behavior (one partial exception flagged as WARNING F2 below).

## 6. Spec Compliance Matrix (behavioral — test-passing evidence)

All 72 requirement IDs are covered by ≥1 passing test (R-UI-NFR-6 gate, dynamic path). Key flagship behaviors verified by test execution + static spot-check:

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R-AUTHUI-1 single-flight bounded refresh | ✅ | api-client tests: 4 concurrent 401s → exactly 1 refresh; refresh fail ≤1 attempt, no loop |
| R-AUTHUI-2 token memory-only | ✅ | storage-scan test (no token keys); source audit — token is module-scoped var, only localStorage use is the locale key |
| R-AUTHUI-3 logout API-then-clear | ✅ | auth.test.tsx; `api/auth.ts` raw-fetch logout, idempotent, errors swallowed |
| R-AUTHUI-4 boot restore + route preservation | ✅ | auth.test.tsx (boot on /orders, no login flash; ?next=) |
| R-UI-FND-1 identical-401 login | ✅ | LoginPage single neutral message; pre-auth toggle test |
| R-UI-FND-2 sidebar per role | ⚠️ 9 modules (see deviation #13 sign-off) | rbac sweep asserts exact 9-item set per role |
| R-UI-FND-3 empty/error/retry + toasts | ✅ | foundation.test.tsx |
| R-UI-FND-4 idempotency replay | ✅ | api-client + stock/orders tests (replay 200 = 1 row) |
| R-RBAC-1..4 route/action guards, parity, demotion | ✅ | rbac.test.tsx 21 tests (five-role exact sweep derived from backend registry; demotion asserts exactly one me() re-fetch per nav) |
| R-UI-NFR-1..7 | ✅ | nfr.test.ts 14 tests; tsc exit 0; build chunks |
| R-UI-DSH-1..4 | ✅ | dashboard.test.tsx (partial failure, alerts, none-low, refresh stale-keep) |
| R-UI-CRM-1..8 | ✅ | customers/products/warehouses tests + stock inactive-exclusion (R-UI-CRM-5) |
| R-UI-STK-1..4 | ✅ | stock.test.tsx (low badge incl. equal, filters, 409 cells unchanged, replay) |
| R-UI-ORD-1..6 | ✅ | orders.test.tsx (optimistic confirm, rollback on 409, INVALID_STATE refresh, D13 es/en/round-trip in formatters) |
| R-UI-NOT-1..3 | ✅ | notifications.test.tsx (snapshot verbatim across locales, badge decrement, hidden at zero) |
| R-UI-AUD-1 | ✅ | audit.test.tsx (`<script>` renders literal text; operator guard no request) |
| R-UI-USR-1..3 | ✅ | users.test.tsx (no locale field asserted; weak password block; self-deactivate zero requests) |
| R-UI-JOB-1..2 | ✅ | jobs.test.tsx (server-side state/queue filters; retry confirm-gated; 404 localized) |
| R-BE-1..5, R-NOT-5, R-PROD-3/7 | ✅ | backend 256/256 incl. locale migration idempotence, per-recipient templates, PATCH me, SPA fallback hermetic tests; live Docker re-confirm |

**Compliance summary**: 72/72 requirement IDs covered by passing tests; 0 failing, 0 untested.

## 7. Coherence (Design ADR-1..8)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| ADR-1 SPA structure + routing map + lazy governance | ✅ | Routes match; lazy chunks verified in build |
| ADR-2 homegrown i18n + pinned catalog + parity | ✅ | 236/236 keys both locales, zero banned tokens (UI + backend), backend templates separate dictionaries |
| ADR-3 single-flight bounded refresh + boot restore | ✅ | client.ts + AuthContext match sequence diagram §4.1 |
| ADR-4 backend delta (migration 007, templates, PATCH me/products, warehouses CRUD, jobs filters, SPA fallback) | ✅ | All present; app.ts ordering verified; WAREHOUSE_IN_USE mapped (flag b ✅) |
| ADR-5 api client contract + D13 float-free | ✅ | `{status,data}` raw envelope; formatters split-on-'.'; envelope deviation typed |
| ADR-6 RBAC mirror + parity + mid-session me() | ✅ | Direct backend import; parity test; Layout re-fetch on pathname |
| ADR-7 test strategy | ✅ | mock fetch single seam (no live backend in UI tests); test names R-XXX-prefixed |
| ADR-8 build/deploy Docker + CI | ✅ | Multi-stage, non-root, HEALTHCHECK, ui/dist copied; CI gate order per R-PROD-3 |

## 8. Deviations Sign-off (#1..#33 — all accepted; severity per item)

| # | Deviation | Sign-off | Reasoning |
|---|-----------|----------|-----------|
| 1 | R-PROD-7 backend tests rewritten to new contract | ✅ ACCEPTED (INFO) | R-PROD-7 was MODIFIED by this change; 256 count stable, zero regressions |
| 2 | Spike: RTL cleanup explicit + npm 11 esbuild allowScripts | ✅ ACCEPTED (INFO) | Handled in setup.ts, root allowScripts, ci.yml/Dockerfile `--allow-scripts` |
| 3 | @vitejs/plugin-react pinned 4.7.0 (Vite 6 compat) | ✅ ACCEPTED (INFO) | Verified peerDependency constraint (6.x requires Vite 8) |
| 4 | jobs.state 6 states (pg-boss v12) not 7 | ✅ ACCEPTED (INFO) | Real enum; UI catalog + dto.ts match; a 7th state could never match a row |
| 5 | errors.conflict.generic added (bare CONFLICT) | ✅ ACCEPTED (INFO) | R-I18N-4 unknown-code fallback preserved; added during pinning |
| 6 | localizeError structural guard instead of instanceof | ✅ ACCEPTED (INFO) | Decouples i18n from client; both error shapes localize |
| 7 | use() for context reading | ✅ ACCEPTED (INFO) | react-19 skill pattern |
| 8 | vitest jsdom global | ✅ ACCEPTED (INFO) | Apply-phase choice (design open question) |
| 9 | GET /api/stock `{items}` envelope typed explicitly | ✅ ACCEPTED (INFO) | Contract test asserts NO data/pagination key; R-UI-STK-1 compliant |
| 10 | Adjust injects `type:'adjustment'` server-side | ✅ ACCEPTED (INFO) | Backend literal lock; found by RED contract test |
| 11 | R-PROD-7 test hardened (dev source OR built assets) | ✅ ACCEPTED (INFO) | Matches R-BE-5 reality (dist build changes module entry) |
| 12 | RBAC parity via direct cross-workspace import | ✅ ACCEPTED (INFO) | Verified importable by tsc + vitest; registry is pure const module |
| 13 | **Sidebar 9 nav modules vs spec "11"** | ✅ ACCEPTED (SUGGESTION) | Spec R-UI-FND-2 "all 11 modules" is internally inconsistent with the spec's own R-RBAC-3 matrix (9 top-level modules; warehouses folded into Stock; 3 stock tabs are page-level). Implementation follows the matrix exactly. Recommend spec wording correction at archive |
| 14 (B2) | LocaleBackendSync added | ✅ ACCEPTED (INFO) | Backend-wins-on-boot (R-I18N-3) without coupling AuthContext↔LocaleContext |
| 15 (B2) | ToastProvider module-scoped emitter | ✅ ACCEPTED (INFO) | Stable showToast identity prevents effect re-fire loops |
| 16 (B2) | LocaleToggle PATCH failure silent | ✅ ACCEPTED (INFO) | Self-heals on next me()/refresh (backend-wins-on-boot); spec doesn't mandate failure UX |
| 17 (B2) | LoginPage useActionState | ✅ ACCEPTED (INFO) | react-19 skill; form action pattern |
| 18 (B2) | User chip raw role/locale identifiers | ✅ ACCEPTED (SUGGESTION) | Pinned catalog lacks role-name keys; technical identifiers consistent with toggle glyphs; cosmetic |
| 19 (B2) | Placeholder pages | ✅ ACCEPTED (INFO) | Transient it2 scaffolding — replaced by real pages it3+ |
| 20 (B2) | useResource cancellation flag (not AbortController) | ✅ ACCEPTED (INFO) | No signal seam in client; flag guards post-unmount state; deps drive refetch |
| 14 (C) | **Transfer 409 code NEGATIVE_STOCK vs spec INSUFFICIENT_STOCK** | ✅ ACCEPTED (INFO) | Verified backend service.ts throws NEGATIVE_STOCK for source insufficiency; UI maps the ACTUAL code via localizeError → localized "stock insuficiente" message; zero-side-effect UX (both cells unchanged) preserved — the R-UI-STK-4 scenario outcome is identical. Spec wording described the code inaccurately; R-I18N-4 maps BOTH codes. Optionally align OpenAPI/spec wording at archive |
| 15 (C) | **Orders list renders #customerId (no customer name in DTO)** | ✅ ACCEPTED (SUGGESTION) | Backend OrderListItemDto has no customerName; per-page customer fetch is out of scope; no silent assumption (id is authoritative). A future additive DTO field would improve UX |
| 16 (C) | Confirm success refreshes orders list only | ✅ ACCEPTED (INFO) | Stock/movements/badge refetch on mount + unread bus; cross-page refresh bus would be over-engineering |
| 17 (C) | R-UI-DSH-2 threshold from GET /api/products?limit=100 | ✅ ACCEPTED (INFO) | Stock rows carry no threshold; spec allows product-record comparison "when available"; unknown-threshold rows skipped (no silent assumption) |
| 18 (C) | Sidebar sweep scoped to within(navigation) | ✅ ACCEPTED (INFO) | Legitimate scoping — dashboard's own Notificaciones link would otherwise pollute the exact-set assert |
| 19 (C) | testTimeout 5000 → 15000 | ✅ ACCEPTED (INFO) | Infra flake mitigation on slow machine; serial runs green |
| 20 (C) | Confirm/cancel toasts use order-specific keys | ✅ ACCEPTED (INFO) | Richer UX; localizeError remains the fallback for all other codes |
| 21 | Create-order Idempotency-Key rotation on failure | ✅ ACCEPTED (INFO) | Matches R-UI-FND-4/R-STK-3 "retry with a NEW key" |
| 22 | ~37 new i18n keys per catalog (S3 gate) | ✅ ACCEPTED (INFO) | Namespace-pure; parity (236/236) + banned-token green |
| 23 | unreadCount() dead code removed | ✅ ACCEPTED (INFO) | Spec-mandated limit=1 pagination.total badge path used; backend endpoint kept |
| 24 | users.usernameTaken dead key | ✅ ACCEPTED (INFO) | Only errors.conflict.usernameTaken referenced; removed at it6 (#31) |
| 25 | rbac auditor test updated for real AuditPage | ✅ ACCEPTED (INFO) | Real page fetch; guard + no-request still asserted |
| 26 | R-UI-JOB-1 guard scenario test added | ✅ ACCEPTED (INFO) | Spec scenario (operator → /jobs → redirect) now covered |
| 27 | Parallel flake pre-existing | ✅ ACCEPTED (INFO) | Infra not test failure; final mitigation at #32 |
| 28 | **R-UI-NFR-6 regex hardened + static 72-ID fallback** | ✅ ACCEPTED | Verifier re-ran the scan: 72/72 unique IDs, pinned list identical to dynamic scan; gate works inside Docker via static list (openspec/ outside context) |
| 29 | **Pre-it6 image served vanilla v1 UI** | ✅ ACCEPTED | Live re-confirmed: the CURRENTLY RUNNING appliance serves the React SPA with the exact current build hash (index-B4-2G7_F.js); curl `/` → SPA shell; R-PROD-7 proven |
| 30 | **R-RBAC-4 = me() re-fetch per navigation** | ✅ ACCEPTED | Design ADR-6; Layout pathname-keyed effect (first render skipped); test asserts exactly ONE me() re-fetch per navigation |
| 31 | users.usernameTaken removed | ✅ ACCEPTED | Verified 236/236 parity, zero references in src/tests |
| 32 | Serial vitest (fileParallelism:false + 15s timeout) | ✅ ACCEPTED | Deterministic gate; my run 217/217 serial |
| 33 | Action sweep expected set from backend registry | ✅ ACCEPTED | Verified rbac.test.tsx derives expected set from imported ROLE_PERMISSIONS — stronger than a hardcoded matrix |

**Deviations verdict: 33/33 accepted** — none rejected. All were reported (never silently decided), all preserve spec intent or fix spec-inaccuracy; 3 carry SUGGESTION-level notes (#13 spec wording, #15/#18 UX polish).

## 9. Issues Found

**CRITICAL** (must fix before archive): None.

**WARNING**:
1. **F1 — R-UI-NFR-3 dist secret scan is vacuous in CI/Docker** (`ui/tests/nfr.test.ts` L79-93). The gate order runs vitest BEFORE `vite build` in both ci.yml (L62-66) and the Dockerfile build stage (L26-27) — so `ui/dist` does not exist during the test run and the scan early-returns (`if (!existsSync(distDir)) return`) without asserting. It only really scans locally with a stale dist present. The in-file comment ("CI builds before the gate") is inaccurate. Fix (orchestrator decision): build before test in the gates, or split the dist scan into a post-build step. (This is a gate-completeness issue, not a code flaw — the source secret scan DOES run everywhere.)
2. **F2 — Spec R-UI-FND-2 "all 11 modules" vs implemented 9** (deviation #13). Acceptable behaviorally; the spec scenario wording contradicts the spec's own matrix. Correct the wording at archive to avoid future confusion.
3. **F3 — Dockerfile build-stage comment (L23-24)** implies openspec specs are "kept in the build context via .dockerignore"; they are NOT (monorepo root, outside `capstone/` context). The .dockerignore comment is correct; the Dockerfile comment is stale. Doc-only fix.

**SUGGESTION**:
- S1: Orders customer column shows `#<customerId>` (#15) — additive `customerName` on the DTO would polish UX.
- S2: User chip raw role/locale identifiers (#18) — optional role-name i18n keys.
- S3: LocaleToggle PATCH failure silent (#16) — optional failure toast; self-heals anyway.

## 10. Verdict

**PASS WITH WARNINGS** — 48/48 tasks, 217/217 vitest + 256/256 backend (real runs by this verifier), tsc clean both, vite build ok, 72/72 requirement-ID coverage, 33/33 deviations accepted, Docker appliance live-serves the React SPA with /api 404 preserved. Three WARNING-level items: the dist-secret scan is a no-op in CI/Docker ordering (F1), a spec wording inconsistency (F2), and a stale Dockerfile comment (F3) — none block archive, all cheap to fix.

**Archive readiness**: READY. Fixes F1/F3 are one-line config/comment changes; F2 is a spec wording note at archive. No code changes required for correctness.

## 11. Artifacts

- Engram topic `sdd/capstone-ui/verify-report` (upsert)
- `openspec/changes/capstone-ui/verify-report.md` (this file)