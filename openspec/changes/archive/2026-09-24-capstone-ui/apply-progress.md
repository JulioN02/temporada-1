# Apply Progress: CAPSTONE-UI — Iteration 2 (it2a bootstrap + i18n + client; it2b auth + shell + guards + components) — DONE

Change: `capstone-ui` · Project: `temporada-1` · Phase: **apply** · Batches B1 (it2a, T-2-1..T-2-5) + B2 (it2b, T-2-6..T-2-10) · Status: ✅ COMPLETE
Date: 2026-09-22 · Evidence: `docs/output-ui-it2a.txt` + `docs/output-ui-it2.txt` · Hybrid (this file + engram topic `sdd/capstone-ui/apply-progress`)

## Batch B2 result (it2b — auth + shell + guards + shared components)

- **UI suite**: vitest 84/84 green, 7 files (41 it2a + **43 new**: auth 14, rbac 14, foundation 15).
- **Typecheck**: `tsc --noEmit` ui CLEAN (strict flags; the cross-workspace parity import type-checks under the ui program).
- **Build**: `npm run build -w ui` ok — governance pages are SEPARATE lazy chunks (AuditPage/UsersPage/JobsPage); initial chunk 111.66 kB gzipped (R-UI-NFR-5 under 250 kB).
- **Backend**: 256/256 green, 58 suites, zero regressions (one R-PROD-7 assertion hardened — deviation #11 below).
- **Evidence**: `docs/output-ui-it2.txt` (real vitest/tsc/build/backend outputs + demo commands).

## Batch B2 tasks (all [x] in tasks.md + engram #1424)

| Task | Contract | Tests (R-XXX) | Files |
|---|---|---|---|
| T-2-6 AuthContext + ProtectedRoute/PermissionRoute/RoleGate | R-AUTHUI-3/4, R-RBAC-1/2 | 6 in auth + 4 RoleGate in rbac | `ui/src/auth/AuthContext.tsx`, `ui/src/components/{ProtectedRoute,PermissionRoute,RoleGate}.tsx` |
| T-2-7 permissions.ts mirror + parity (design flag c = DIRECT import) | R-RBAC-3 | 4 parity + 5 sweep | `ui/src/auth/permissions.ts`, `ui/tests/rbac.test.tsx` |
| T-2-8 LoginPage + Layout/Sidebar + LocaleToggle + ToastProvider + App routes (lazy governance) + dark theme | R-UI-FND-1/2, R-I18N-3, R-UI-NFR-5 | 7 in auth (login/sidebar/toggle) | `ui/src/pages/LoginPage.tsx`, `ui/src/components/{Layout,Sidebar,LocaleToggle,LocaleBackendSync,ToastProvider}.tsx`, `ui/src/App.tsx`, `ui/src/main.tsx`, `ui/src/styles/index.css` |
| T-2-9 Shared components + hooks | R-UI-FND-3, R-UI-ORD-6 (MoneyText) | 11 in foundation | `ui/src/components/{DataTable,Pagination,Modal,FormField,Badge,EmptyState,ErrorState,LoadingState,ConfirmButton,MoneyText,DebouncedSearchInput}.tsx`, `ui/src/hooks/{useResource,usePagination,useDebouncedValue}.ts` |
| T-2-10 Foundation tests + evidence | R-UI-FND-4, R-AUTHUI-2, R-RBAC-1 | 4 + 1 + 1 | `ui/tests/{auth,rbac,foundation}.test.tsx`, `docs/output-ui-it2.txt` |

Total new tests this batch: **43**; cumulative suite **84** (requirement-referenced names, cumulative gate active).

## Deviations / findings (reported — NOT silently decided)

11. **R-PROD-7 test hardened (it2b discovery)**: the it2a assertion `html.includes('/src/main.tsx')` broke locally after ANY `npm run build -w ui` — `dist/` (gitignored) makes the static mount serve the BUILT shell (`/assets/*.js`), the correct R-BE-5 behavior. Assertion now accepts dev-source OR built-assets module entry. Count stays 256.
12. **RBAC parity path = design flag c (DIRECT import)**: `tests/rbac.test.tsx` imports `../../backend/src/permissions/registry.ts` — verified importable by vitest AND tsc (pure const module, no server-only imports). JSON fixture fallback NOT needed.
13. **Spec R-UI-FND-2 says "admin → all 11 modules"; the pinned 168-key catalog has 9 `nav.*` keys** — the sidebar renders exactly the 9 module entries the catalog supports (3 stock tabs are page-level, not sidebar entries). Admin sweep test asserts 9. Reported; S3 gate respected (no new keys invented).
14. **`LocaleBackendSync` added** (small component, design file tree didn't list it): implements backend-wins-on-boot without coupling AuthProvider to LocaleContext (keeps AuthContext unit-testable standalone). Rendered once at the app root inside both providers.
15. **ToastProvider uses a module-scoped emitter** (`showToast` stable identity) instead of a context value — avoids effect re-fire loops (PermissionRoute denial toasts keyed on `allowed` only). `useToast()` returns the stable function.
16. **LocaleToggle post-auth PATCH failure is deliberately silent** (optimistic local state stands; backend corrects on next me/refresh — backend-wins-on-boot self-heals). Design didn't specify failure UX; noted for review.
17. **LoginPage uses `useActionState`** (react-19 skill) + plain `FormField`/`Input` — shared components built within the same batch (tasks order respected: auth/guards → shell → components; components wired into the shell as built).
18. **User chip shows the raw role/locale identifiers** (e.g. `admin`, `es`) — the pinned catalog has no role-name keys; consistent with the ES/EN toggle glyphs being technical identifiers.
19. **Placeholder pages** (it3+ build on them) render the localized module title from existing pinned keys — no new copy, no S3-gate violation. Governance pages lazy-chunked (R-UI-NFR-5).
20. **`useResource` uses a cancellation flag, not AbortController** (design mentioned abortable fetch; the api client has no signal seam — flag guards state after unmount, deps array drives refetch).

## Notes for downstream phases (it3+)

- Auth/shell/guards/components are the foundation for every page: `useResource` + `DataTable` + `Pagination` + `Badge` + `ConfirmButton` + `MoneyText` + `DebouncedSearchInput` + toasts are ready; `Sidebar` exposes the `notificationBadge` slot for it5 (R-UI-NOT-3).
- PermissionRoute (redirect + denial toast, no API) guards /audit /users /jobs; module pages (it3+) build directly on the shell.
- Root `npm test` runs backend + ui; evidence doc updated (`docs/output-ui-it2.txt`).

## Batch B1 result (it2a — bootstrap + i18n + client; carried forward)

- **UI suite**: vitest 41/41 green, 4 files (FIRST vitest run in the repo — spike concluded, `docs/spike-vitest-rtl.md`).
- **Typecheck**: `tsc --noEmit` ui CLEAN (strict flags proven by RED probe: noUncheckedIndexedAccess / exactOptionalPropertyTypes / erasableSyntaxOnly).
- **Build**: `npm run build -w ui` ok — dist 70.05 kB gzipped initial chunk (R-UI-NFR-5 250 kB cap comfortably met at this early stage).
- **Backend**: 256/256 green, 58 suites, zero regressions. R-PROD-7 tests UPDATED to the modified contract (vanilla files removed); count unchanged.
- **Scaffold**: ui/ workspaces replaced vanilla v1 (index.html → Vite shell, app.js DELETED); root scripts typecheck/test/build → both workspaces.

## Batch B1 tasks (all [x] in tasks.md)

| Task | Contract | Tests (R-XXX) | Files |
|---|---|---|---|
| T-2-1 ui/ scaffold + vanilla removal | R-PROD-7 modified | probe RED→GREEN; smoke | `ui/{package.json,tsconfig.json,vite.config.ts,index.html}`, `ui/src/{main,App}.tsx`, `ui/src/styles/index.css`, `ui/tests/setup.ts`, `package.json` (root), `backend/tests/integration/{ui,smoke}.test.ts` (R-PROD-7 updated) |
| T-2-2 vitest+RTL spike | design flag d | 2 scratch (removed) | `docs/spike-vitest-rtl.md` |
| T-2-3 mock fetch harness | R-UI-NFR-6 | 3 | `ui/tests/helpers/mockFetch.ts`, `ui/tests/__fixtures__/api.ts`, `ui/tests/mock-fetch.test.ts` |
| T-2-4 i18n infra (catalog PINNED) | R-I18N-1..4, R-UI-ORD-6 | 13 + 11 formatters | `ui/src/i18n/*` (types, es, en, LocaleContext, useTranslation, localizeError, formatters), `ui/tests/i18n.test.tsx`, `ui/tests/formatters.test.ts` |
| T-2-5 api client | R-AUTHUI-1, R-UI-FND-4, R-UI-NFR-6 | 14 | `ui/src/api/{client,types,auth,users,customers,products,warehouses,stock,orders,notifications,audit,jobs}.ts`, `ui/tests/api-client.test.ts` |

Total tests it2a: **41** (requirement-referenced names, cumulative gate active).

## Deviations / findings (it2a — reported — NOT silently decided)

1. **Backend R-PROD-7 tests updated at T-2-1** (expected — R-PROD-7 MODIFIED): the two obsolete vanilla assertions (`/` shows login form; `/app.js` is the vanilla client) were rewritten to the new contract (`/` serves the Vite shell; `/app.js` → SPA fallback shell via hermetic fixture dist). The 3 API-contract tests were kept. Count stays 256 — zero regressions.
2. **Spike finding (kept config)**: RTL auto-cleanup does NOT self-register with vitest `globals:false` — explicit `afterEach(cleanup)` in `tests/setup.ts` (first spike run failed with duplicated DOM). Also: npm 11 `allowScripts` gates the esbuild postinstall — approve + `npm rebuild esbuild` needed on fresh installs (relevant for it6 CI/Docker).
3. **@vitejs/plugin-react pinned to 4.7.0** (the 6.x line requires Vite 8 — incompatible with the locked Vite 6; verified via peerDependencies).
4. **jobs.state.expired dropped from the pinned UI catalog**: the installed pg-boss v12 enum has 6 states (apply-progress it1 deviation #2). The 6 real states are in the catalog; the design's 7th could never match a row. Catalog pinned accordingly.
5. **`errors.conflict.generic` ADDED at pin time**: the backend warehouse duplicate-name throws bare `CONFLICT` (stock service note) — localizeError maps it (R-I18N-4 scenario "bare CONFLICT"). S3 gate: additions after pinning require review — this was added DURING pinning.
6. **localizeError uses a STRUCTURAL guard** (`{code: string}`) instead of `instanceof ApiClientError` — decouples i18n from api/client (no import cycle; both client errors and backend `{error:{code}}` shapes localize). Design-compatible (ADR-5 says message is the code string, never rendered raw).
7. **`use()` (React 19) used for context reading** in `useLocale` (react-19 skill); provider internals use useState/useEffect.
8. **vitest jsdom environment set GLOBALLY** (design open question §10 resolved at apply — no per-file annotations).
9. **GET /api/stock envelope deviation typed explicitly**: `StockLevelsResponse {items: StockRow[]}` snake_case — contract test asserts NO `data`/`pagination` key.
10. **Adjust mutation injects `type:'adjustment'`** server-side contract (backend literal lock) — caller inputs omit it (found by RED contract test).

## Notes for downstream phases (it2b → it3+)

- `api/client.ts` is refresh-ready: `refreshAccessToken()` (boot-restore seam), `setAccessToken`, `setSessionExpiredHandler` — wired by AuthContext (T-2-6).
- LocaleContext provides the pre-auth persistence half of R-I18N-3; LocaleToggle (post-auth PATCH /api/auth/me + backend-wins-on-boot) landed at T-2-8.
- Root `npm test` now runs backend + ui; CI (it6) will get explicit ui steps per R-PROD-3 modified.
- The vanilla static mount in app.ts was KEPT (serves the Vite source index.html in dev; prod uses dist + fallback) — removal decision deferred (it6 Docker/CDN pass).
- Key catalog pinned: 168 keys; it3+ additions ONLY via review (S3 gate).
---

# Apply Progress: CAPSTONE-UI — Batch C (it3 Dashboard+CRM + it4 Stock+Orders) — DONE

Date: 2026-09-23 · Batches: C (it3 T-3-1..T-3-8 + it4 T-4-1..T-4-9) · Status: ✅ COMPLETE
Evidence: `docs/output-ui-it3.txt` + `docs/output-ui-it4.txt` · Hybrid (this file + engram topic `sdd/capstone-ui/apply-progress`)

## Batch C result

- **UI suite**: vitest **155/155 green, 13 files** (84 it2 + 71 new: dashboard 10, customers 14, products 11, warehouses 7, stock 14, orders 15).
- **Typecheck**: `tsc --noEmit` ui CLEAN (strict).
- **Build**: `npm run build -w ui` ok — initial chunk 130.51 kB gzip (R-UI-NFR-5 < 250 kB), governance lazy chunks intact.
- **Backend**: **256/256 green** (58 suites) — zero regressions (Batch C touched UI only).
- **Evidence**: `docs/output-ui-it3.txt` + `docs/output-ui-it4.txt` (real outputs).

## Batch C tasks (all [x] in tasks.md + engram #1424)

| Task | Contract | Tests (R-XXX) | Files |
|---|---|---|---|
| T-3-1 DashboardPage (status/KPI/low-stock/notifications/refresh) | R-UI-DSH-1..4 | 10 dashboard | `ui/src/pages/DashboardPage.tsx`, `ui/src/api/status.ts`, `ui/src/modules/dashboard/lowStock.ts` |
| T-3-2 CustomersPage list/search/filter/pagination | R-UI-CRM-1 | 4 | `ui/src/pages/CustomersPage.tsx` |
| T-3-3 Customer create/edit forms + validation | R-UI-CRM-2/3 | 5 + 2 pure | `ui/src/modules/crm/{customerForm.ts,CustomerForm.tsx}` |
| T-3-4 Deactivate/reactivate confirm gate | R-UI-CRM-4 | 3 | CustomersPage |
| T-3-5 ProductsPage + create form | R-UI-CRM-5/6 | 5 + 2 pure | `ui/src/pages/ProductsPage.tsx`, `ui/src/modules/crm/{productForm.ts,ProductForm.tsx}` |
| T-3-6 Product edit/deactivate via PATCH | R-UI-CRM-7 | 3 | ProductsPage/ProductForm |
| T-3-7 Warehouses tab (list/create/rename/delete) | R-UI-CRM-8 | 7 | `ui/src/modules/stock/WarehousesTab.tsx` |
| T-3-8 CRM tests + evidence | — | — | `docs/output-ui-it3.txt` |
| T-4-1 Levels table + low badge + filters | R-UI-STK-1 | 4 + 1 pure | `ui/src/pages/StockPage.tsx`, `ui/src/modules/stock/forms.ts` |
| T-4-2 Movements tab + filters + pagination | R-UI-STK-2 | 2 | StockPage + `api/stock.ts` (listMovements → MovementListItem) |
| T-4-3 Adjust form (409 NEGATIVE_STOCK, key rotation) | R-UI-STK-3 | 4 | `ui/src/modules/stock/AdjustForm.tsx` |
| T-4-4 Transfer form (from≠to, 409 cells unchanged) | R-UI-STK-4 | 3 | `ui/src/modules/stock/TransferForm.tsx` |
| T-4-5 OrdersPage + OrderDetailPage | R-UI-ORD-1/2 | 5 | `ui/src/pages/{OrdersPage,OrderDetailPage}.tsx` |
| T-4-6 Create order (line editor, parseMoney, key) | R-UI-ORD-3 | 4 | `ui/src/modules/orders/{validate.ts,CreateOrderForm.tsx}` |
| T-4-7 Confirm (useOptimistic + rollback) | R-UI-ORD-4 | 4 | OrdersPage |
| T-4-8 Cancel with reason gate | R-UI-ORD-5 | 2 | `ui/src/modules/orders/CancelOrderModal.tsx` |
| T-4-9 Stock+orders tests + evidence | — | — | `docs/output-ui-it4.txt` |

## Deviations / findings (reported — NOT silently decided)

14. **Transfer insufficient-stock code is NEGATIVE_STOCK, not INSUFFICIENT_STOCK**: backend `stock/service.ts transfer()` throws `409 NEGATIVE_STOCK` for source insufficiency (spec R-UI-STK-4 wording says INSUFFICIENT_STOCK). The UI maps the ACTUAL code → localized negative-stock message; the zero-side-effect UX (both cells unchanged) is preserved regardless. Reported; spec wording vs backend contract mismatch.
15. **Orders list has NO customer name** (backend `OrderListItemDto {id,customerId,state,total,createdAt}`): the table renders `#<customerId>`. Reported — resolving names would need a customer fetch per page (out of scope).
16. **Confirm success refreshes the orders list only** (visible data). Stock/movements/notifications refetch on their routes' mount (useResource), so no stale data is visible; a cross-page refresh bus was NOT added (over-engineering). Reported.
17. **R-UI-DSH-2 threshold source**: stock rows carry NO threshold → the dashboard + levels derive it from `GET /api/products?limit=100`; rows whose product is beyond that page can't be proven low and are skipped (no silent assumption). Reported.
18. **Sidebar tests scoped to `within(navigation)`**: the real dashboard (R-UI-DSH-3) legitimately renders its own "Notificaciones" link; the it2 sidebar-sweep tests (rbac/auth) now scope to the sidebar nav to keep asserting the EXACT module set.
19. **`vitest` testTimeout raised 5000 → 15000** (vite.config.ts): the pre-existing parallel-execution flake (it2 baseline showed 3-4 random 5s timeouts on this slow machine; 84/84 serial) is an infrastructure issue, not a test failure — mitigated at config, reported.
20. **Confirm/cancel toasts use the ORDER-SPECIFIC keys** (`orders.confirm.insufficient` / `orders.confirm.invalidState` — spec wording) instead of the generic `errors.conflict.*` map; adjust/transfer use the generic map. localizeError remains the fallback for all other codes.
21. **Create-order key rotation**: the form's Idempotency-Key is regenerated after ANY failed attempt (client cannot know whether the server persisted the key) — matches R-UI-FND-4/R-STK-3 "retry with a NEW key".
22. **i18n additions (~37 keys per catalog)**: review-gated per S3; all are namespace-pure new strings (crm.customer.*, crm.product.*, crm.warehouse.*, stock.*, orders.*). Parity (R-I18N-1) + banned-token (R-I18N-2) green.

## Notes for downstream phases (it4 → it5)

- Stock page tabs (levels/movements/warehouses) ready; WarehousesTab reusable standalone.
- `api/stock.ts listMovements` now returns `Paginated<MovementListItem>` (was mis-typed `Paginated<StockRow>` — fixed contract fidelity).
- Orders confirm is the optimistic showpiece — reuse the pattern for jobs retry / user deactivate (it5).
- it5 governance pages still placeholders (NotificationsPage placeholder remains); sidebar unread-badge slot (T-2-8) is ready for R-UI-NOT-3.

---

# Apply Progress: CAPSTONE-UI — Batch E (it6 Polish + Evidence) — DONE — **FINAL (48/48)**

Date: 2026-09-23 · Batch: E (it6 T-6-1..T-6-6) · Status: ✅ COMPLETE — **change ready for sdd-verify**
Evidence: `docs/output-ui-it6.txt` · Hybrid (this file + engram topic `sdd/capstone-ui/apply-progress`)

## Batch E result

- **UI suite**: vitest **217/217 green, 18 files** (195 it1-it5 + **22 new**: nfr 14, rbac +7, stock +1), serial (`fileParallelism: false`) — deterministic gate.
- **Typecheck**: `tsc --noEmit` CLEAN both workspaces (root `npm run typecheck` exit 0).
- **Build**: `npm run build -w ui` ok — initial chunk **132.53 kB gzip** (R-UI-NFR-5 < 250 kB); governance lazy chunks intact.
- **Backend**: **256/256 green** (58 suites) — zero regressions (it6 touched UI/infra/docs only).
- **Docker**: image built with the FULL quality gate inside the build stage; `docker compose up -d` → API healthy (`/api/health` `{"status":"ok","db":"up"}`), `/` serves the **React SPA** (`<div id="root">` + `/assets/index-B4-2G7_F.js`), `/api/docs` 200 (Swagger UI), deep link `/orders/42` → 200 SPA fallback, `/api/does-not-exist` → 404 preserved. The pre-it6 running image (45h old) served the OLD vanilla v1 UI — the rebuild confirms R-PROD-7 modified.
- **Evidence**: `docs/output-ui-it6.txt` (REAL outputs).

## Batch E tasks (all [x] in tasks.md — 48/48 total)

| Task | Contract | Tests (R-XXX) | Files |
|---|---|---|---|
| T-6-1 RBAC five-role exact sweep + mid-session demotion | R-RBAC-2/3/4 | +7 (rbac 14→21) | `ui/tests/rbac.test.tsx`, `ui/src/components/Layout.tsx` (me() re-fetch per route change) |
| T-6-2 NFR scan suite | R-UI-NFR-1..7, R-PROD-3, R-I18N-4 (flag b) | 14 new | `ui/tests/nfr.test.ts` (created) |
| T-6-3 stock inactive exclusion (conditional — resolved) | R-UI-CRM-5 | +1 (stock 14→15) | `ui/tests/stock.test.tsx` (backend already `WHERE p.active = true`, #1433) |
| T-6-4 Docker multi-stage ui stage + CI gate | R-PROD-3 modified, R-UI-NFR-7, R-PROD-7 | scans in nfr.test.ts | `Dockerfile`, `.github/workflows/ci.yml`, `.dockerignore` |
| T-6-5 Polish + README + dashboard + flake mitigation | R-PROD-6/7 | — | `README.md`, `docs/evidence/index.html`, `ui/vite.config.ts` (serial), locales (dead key removed) |
| T-6-6 Final evidence | R-UI-NFR-7 | — | `docs/output-ui-it6.txt` |

## Deviations / findings (reported — NOT silently decided)

28. **R-UI-NFR-6 coverage regex was silently incomplete**: the it6 scan's `\bR-[A-Z0-9]+-[0-9]+\b` could NOT match multi-segment IDs (`R-UI-CRM-1`, `R-UI-NFR-6`, …) — the gate enforced only single-segment R-IDs. Fixed to `\bR-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+\b`; all **72** spec IDs now enforced (verified complete: 0 missing). A static 72-ID fallback list was embedded so the SAME gate runs inside the Docker build context (monorepo-root `openspec/` is not in the `capstone/` context) — mirrors backend R-NFR-3's static-list pattern. `.dockerignore` comment corrected (it claimed openspec was kept in the context — it is not).
29. **Pre-it6 running image served the OLD vanilla v1 UI** (45h old): the it6 Dockerfile had never been built. `docker compose build` + `up -d` verified: the new image's build stage runs the full gate (typecheck both + vitest + vite build) and the runtime serves the React SPA at `/`. This is the R-PROD-7 modified proof.
30. **Mid-session demotion behavior (R-RBAC-4) — implementation detail**: `Layout.tsx` re-fetches `GET /api/auth/me` on EVERY route change (design ADR-6). Demotion reflects on the next navigation (sidebar drops the module + PermissionRoute denies stale routes with a localized toast); no polling, no re-login. Tests assert exactly ONE me() re-fetch per navigation.
31. **`users.usernameTaken` dead key REMOVED** (B4 finding, T-6-5): verified zero references in `ui/src` + tests; only `errors.conflict.usernameTaken` is used (via localizeError). Removed from BOTH catalogs — parity (R-I18N-1) green, banned-token green.
32. **Flake mitigation final**: `fileParallelism: false` (serial test files) + `testTimeout: 15000` — the cumulative gate is now deterministic (was intermittent parallel timeouts on this slow machine; deviations #19/#27). Vitest still suggests `pool: 'vmThreads'` for environment-creation speed — NOT needed (correctness > speed; serial is the deterministic choice).
33. **R-RBAC-3 action sweep expected set derived from the BACKEND registry** (not a hardcoded matrix): the five-role × 13-action RoleGate sweep computes the expected visible set from the imported backend `ROLE_PERMISSIONS` — any backend RBAC change immediately flips the sweep (stronger than a copied matrix; still exact, no extra/no missing).

## Notes for sdd-verify

- Full change: 48/48 tasks, 217 vitest + 256 backend, tsc clean both, vite build ok, Docker appliance serves the React SPA.
- Verify focus: (a) deviations across batches (#1..33 — esp. #28 regex hardening, #14 transfer NEGATIVE_STOCK code, #13 sidebar 9 vs 11 modules, #15 orders no customer name); (b) RBAC sweep outcome (five-role sidebar + action matrix exact); (c) Docker SPA serving (curl `/` → React shell); (d) cumulative requirement-ID coverage (72 IDs).
- Evidence chain: `docs/output-ui-it1..it6.txt` + `docs/evidence/index.html` (all 6 UI iterations listed).

---

# Apply Progress: CAPSTONE-UI — Batch D (it5 Governance: Notifications, Audit, Users, Jobs) — DONE

Date: 2026-09-23 · Batch: D (it5 T-5-1..T-5-6) · Status: ✅ COMPLETE
Evidence: `docs/output-ui-it5.txt` · Hybrid (this file + engram topic `sdd/capstone-ui/apply-progress`)

## Batch D result

- **UI suite**: vitest **195/195 green, 17 files** (155 it2-it4 + **40 new**: notifications 10, audit 8, users 12, jobs 10).
- **Typecheck**: `tsc --noEmit` ui CLEAN (strict).
- **Build**: `npm run build -w ui` ok — initial chunk **132.63 kB gzip** (R-UI-NFR-5 < 250 kB); governance lazy chunks intact (AuditPage 2.52 / UsersPage 3.13 / JobsPage 2.60 kB gzip).
- **Backend**: **256/256 green** (58 suites) — zero regressions (it5 touched UI + tests only).
- **Evidence**: `docs/output-ui-it5.txt` (real outputs).

## Batch D tasks (all [x] in tasks.md + engram #1424)

| Task | Contract | Tests (R-XXX) | Files |
|---|---|---|---|
| T-5-1 Notifications page + unread filter + snapshot + mark-read + sidebar badge | R-UI-NOT-1..3 | 10 | `ui/src/pages/NotificationsPage.tsx`, `ui/src/modules/governance/{notifications.ts,unreadBus.ts,NotificationBadge.tsx}`, `ui/tests/notifications.test.tsx` |
| T-5-2 Audit page (filters + JSON-text payload + operator guard) | R-UI-AUD-1 | 8 | `ui/src/pages/AuditPage.tsx`, `ui/src/modules/governance/audit.ts`, `ui/tests/audit.test.tsx` |
| T-5-3 Users list + create/invite (NO locale, password strength) | R-UI-USR-1/2 | 12 | `ui/src/pages/UsersPage.tsx`, `ui/src/modules/governance/{userForm.ts,UserForm.tsx}`, `ui/tests/users.test.tsx` |
| T-5-4 User edit role/active + self-deactivate blocked | R-UI-USR-3 | (in users) | UsersPage/UserForm |
| T-5-5 Jobs page server-side filters + confirm-gated retry + 404 | R-UI-JOB-1/2 | 10 | `ui/src/pages/JobsPage.tsx`, `ui/src/modules/governance/jobs.ts`, `ui/tests/jobs.test.tsx` |
| T-5-6 Governance tests + evidence | — | — | `docs/output-ui-it5.txt` |

## Deviations / findings (reported — NOT silently decided)

23. **`ui/src/api/notifications.ts unreadCount()` + `UnreadCountResponse` removed as dead code**: the sidebar badge uses the spec-mandated `GET /api/notifications?unreadOnly=true&limit=1` pagination.total (R-UI-NOT-3); the wrapper calling `/api/notifications/unread-count` was never imported. Backend endpoint kept (R-NOT-1 integration tests still cover it).
24. **`users.usernameTaken` catalog key is dead** (es+en): the 409 `USERNAME_TAKEN` localizes via `errors.conflict.usernameTaken` ("El nombre de usuario ya está en uso"). The unused `users.usernameTaken` ("…o correo ya está en uso") is left in both catalogs (parity holds) — flagged for it6 cleanup; NOT removed to avoid mutating the pinned catalog mid-batch.
25. **`tests/rbac.test.tsx` R-RBAC-1 auditor test updated for the real AuditPage**: the it5 page fetches `/api/audit` on mount (placeholder didn't) — the test now serves an empty page and raises the lazy-chunk heading wait to 10 s (first-load transform on this slow machine; same class as Batch C deviation #19). 14/14 green.
26. **R-UI-JOB-1 guard scenario test added** (operator → /jobs → redirect, no request): the spec scenario wasn't covered by the prior run's jobs.test.tsx (audit/users had theirs); mirrors the established PermissionRoute guard pattern. jobs tests went 9 → 10.
27. **Parallel flake confirmed pre-existing (NOT a test failure)**: intermittent random timeouts under parallel file execution — one full run failed `stock R-UI-STK-2`, another `orders R-UI-ORD-3`; both pass 100% in isolation; final cumulative run 195/195. Mitigation `testTimeout: 15000` stays; a `pool: 'vmThreads'`/serial strategy is deferred to it6 (T-6-4 CI/Docker).

## Notes for downstream phases (it5 → it6)

- Governance pages fully wired: sidebar unread badge live (R-UI-NOT-3); PermissionRoute guards on /audit /users /jobs; lazy chunks intact.
- `modules/governance/` holds pure helpers (label maps + validators) — ready for the it6 NFR scans (no-any, no dangerouslySetInnerHTML, dist secret scan, requirement-ID coverage).
- Batch E = it6 polish + evidence (T-6-1..T-6-6): RBAC five-role exact-matrix sweep + mid-session demotion, NFR scans, Docker multi-stage ui stage + CI, README, final cumulative evidence `docs/output-ui-it6.txt`.
