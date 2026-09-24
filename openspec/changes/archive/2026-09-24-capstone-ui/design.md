# Design: CAPSTONE-UI — Full React 19 SPA + System-wide ES/EN i18n

Change: `capstone-ui` · Project: `temporada-1` · Phase: **design** · Artifact store: **hybrid**
Date: 2026-09-22 · Upstream: specs (6 files under `openspec/changes/capstone-ui/specs/` + api-surface-gaps #1421) · Downstream: tasks
STRICT TDD active — every ADR maps to spec scenarios (R-XXX) → vitest/RTL (frontend) + `node --test` (backend delta) cases in apply.

## 1. Overview

Replace the rejected v1 vanilla verification UI (`capstone/ui/index.html` + `app.js`) with a **React 19 SPA** (Vite 6, react-router-dom 7, React Compiler, strict TS) that exercises the verified backend surface (229/229 green) plus an **approved additive backend delta** (decision #1422): migration 007 locale columns, bilingual notification templates, `PATCH /api/auth/me {locale}`, `PATCH /api/products/:id`, warehouses CRUD, server-side jobs filters, and SPA history-fallback serving. System-wide ES/EN i18n (neutral Spanish, default `es`). Frontend test contract is **new**: vitest + React Testing Library + jsdom (first runner in the repo).

Locked decisions (not re-opened): React 19/Vite 6/RR7/Compiler; toggle ES/EN everywhere; default `'es'`; pre-auth toggle → localStorage only; warehouses CRUD in Stock module (manager+); e2e deferred; tokens memory-only + httpOnly refresh cookie + bounded 401→refresh→retry→logout; homegrown i18n dictionaries (zero deps); vitest+RTL; single container (Vite build → API serves `dist/`).

## 2. Technical Approach

- **SPA workspace** `capstone/ui/` (npm workspace already declared in root): Vite 6 + React 19 + `@vitejs/plugin-react` + `babel-plugin-react-compiler`; strict tsconfig mirroring backend flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`); const-types pattern; `import type`; no `any` (R-UI-NFR-1/4).
- **Same-origin**: Vite dev proxy `/api` → `:3000` (no CORS, cookies flow — precedent inventory-stock); prod: express serves `ui/dist` + SPA fallback (R-BE-5).
- **Port-adapt** from `proyectos-profesionales/inventory-stock/frontend`: `api/client.ts` fetch wrapper (enhanced: single-flight refresh), `AuthContext`, `ProtectedRoute`, `RoleGate`, `LocaleContext`/`useTranslation`, dark theme.
- **State**: plain fetch + hooks + context (no TanStack Query — locked out-of-scope; justified in ADR-1). React 19 `use()` for promise consumption where ergonomic; `useActionState`/`useOptimistic` for mutations (R-UI-ORD-4 optimistic confirm).
- **Backend delta**: additive, vertical-slices preserved (`routes → controller ≤15 lines → service → repository → dto`), zod DTOs drive OpenAPI regeneration (R-DOC-1).

## 3. Architecture Decisions

### ADR-1 — Frontend architecture: SPA structure, routing map, state management

**Choice**: Vite SPA with folder layout `ui/src/{api,auth,components,hooks,i18n,modules,pages,styles}`; react-router-dom 7 with `createBrowserRouter`; route-level code-splitting via `lazy()` for governance pages (R-UI-NFR-5). Routing map:

| Route | Guard | Permission (R-RBAC-3) |
|---|---|---|
| `/login` | public (redirects to `/` if authed) | — |
| `/dashboard` | `ProtectedRoute` | all 5 roles |
| `/customers` | `ProtectedRoute` | `crm:customer_read` |
| `/products` | `ProtectedRoute` | `stock:stock_read` |
| `/stock` (tabs: levels/movements/warehouses) | `ProtectedRoute` | `stock:stock_read` |
| `/orders`, `/orders/:id` | `ProtectedRoute` | `orders:order_read` |
| `/notifications` | `ProtectedRoute` | `notification:read` |
| `/audit` | `PermissionRoute` | `audit:read` |
| `/users` | `PermissionRoute` | `auth:user_read` |
| `/jobs` | `PermissionRoute` | `jobs:job_read` |
| `*` | — | redirect `/dashboard` + localized toast |

Guards: `ProtectedRoute` (auth + boot-restore loading, preserves intended route → `/login?next=` — R-AUTHUI-4) wrapping `PermissionRoute` (permission check → `Navigate` to `/dashboard` + localized denial toast, NO API call — R-RBAC-1). Module pages live in `pages/`; module-scoped components in `modules/<module>/components/` (vertical-slices: pages → components → api client → hooks).

**State management**: plain hooks + React context. `useResource(path, params)` hook (abortable fetch, `{data, loading, error, refetch}`) for page data; `AuthContext` for user/token/permissions; `LocaleContext` for locale; `ToastContext` for toasts. Mutations via `useActionState` (form actions) + `useOptimistic` (order confirm). **Alternatives rejected**: TanStack Query — locked out of scope (proposal §21); the app is per-page server state with on-demand refresh; a 60-line hook covers it and keeps zero deps. Redux/Zustand — state is tiny (user, locale, toasts); context suffices. `use()` for data fetching in render — rejected for page data (less testable under RTL `act`, no abort); `use()` allowed for reading context/promises inside render per react-19 skill.

**Tests**: R-UI-FND-2, R-RBAC-1..3, R-UI-NFR-5 (split chunks scan), R-AUTHUI-4.

### ADR-2 — i18n architecture: homegrown dictionaries + parity + neutral-Spanish gate

**Choice**: const dictionaries `src/i18n/locales/es.ts` / `en.ts` with `MessageKey = keyof typeof en` (compile-time parity: a key missing from `es` is a tsc error) + runtime parity test asserting identical key sets both directions (R-I18N-1). `LocaleContext` + `useTranslation()` (`t(key, params)` with `{token}` interpolation — ported precedent). Namespaces per module via flat dotted keys (`common.*`, `auth.*`, `nav.*`, `dashboard.*`, `crm.*`, `stock.*`, `orders.*`, `notifications.*`, `audit.*`, `users.*`, `jobs.*`, `errors.*`). No hardcoded user-facing literals outside dictionaries (enforced by review + spot tests). Key catalog pinned at it2 (frozen thereafter; additions only via review).

**Toggle semantics** (R-I18N-3): default `'es'`; pre-auth → localStorage only (no API call); post-auth → `PATCH /api/auth/me {locale}` + localStorage; backend wins on boot (`user.locale` from `/api/auth/me`/login overrides localStorage, localStorage corrected). `document.documentElement.lang` synced in effect. Full-tree re-render without reload (context value change).

**Neutral Spanish gate**: banned-token scan (vos/tenés/querés/sos/andá/che/dale) over UI dictionaries AND backend template dictionaries (R-I18N-2, R-BE-2); register review at apply; design-critic passes strings.

**Backend templates do NOT share code with the UI** (two separate TS projects — no shared module): `backend/src/jobs/templates.ts` gets its own bilingual dictionaries `{es, en}` with identical key sets per type + its own parity test (R-BE-2). Render happens ONCE at emit time in the recipient's stored locale; the immutable snapshot (title/body/locale) is stored on the row; the worker never re-renders (R-NOT-5, R-BE-3).

**Alternatives rejected**: i18next/react-intl — 2 locales, flat keys, zero-dep supply-chain + bundle goal (locked); per-component string files — drift risk; runtime locale resolution from Accept-Language for templates — email recipients send no headers (proposal §Approach).

**Tests**: R-I18N-1 parity, R-I18N-2 banned tokens (UI + backend), R-I18N-3 toggle scenarios, R-I18N-4 error mapping, R-UI-NOT-1 snapshot display.

### ADR-3 — Refresh flow: single-flight, bounded, session restore (sequence diagram §4.1)

**Choice**: port `api/client.ts` (inventory-stock) and enhance: module-scoped `accessToken` (memory only — never localStorage/sessionStorage/cookies, R-AUTHUI-2); single-flight refresh — `let refreshPromise: Promise<string|null> | null`; concurrent 401s await the SAME in-flight `POST /api/auth/refresh` (cookie) and all retry once; bounded — a request already retried never refreshes again; refresh 401 → clear token + user, invoke `onSessionExpired` → router lands on `/login` (no loop by construction: max 1 refresh + 1 retry per original request, R-AUTHUI-1). Login/refresh requests themselves never trigger the refresh path. Errors surface as `ApiClientError {status, code, message}` — message is a server code string, never rendered raw (ADR-5).

**Boot restore** (R-AUTHUI-4): `AuthProvider` on mount calls `POST /api/auth/refresh` (cookie present → new access + user; the refresh response carries `{user, accessToken}` — R-AUTH-4); success → token + user set, `initializing=false`, protected routes render; failure → `/login` with `?next=` (bounded, no loop). Not `/api/auth/me`-first: restore needs a token before `me`; refresh IS the restore (single round trip).

**Logout** (R-AUTHUI-3): call `POST /api/auth/logout` via raw `fetch` (cookie-only — works with expired access token; errors swallowed, idempotent 204) THEN clear memory token + user + redirect `/login`. Sidebar logout for every role.

**Tests**: R-AUTHUI-1 (expired mid-session / concurrent 401s coalesce — exactly 1 refresh call / refresh fails ≤1 attempt), R-AUTHUI-2 (storage scan + reload restore), R-AUTHUI-3, R-AUTHUI-4.

### ADR-4 — Backend delta implementation (approved & expanded, #1422)

**Choice**: additive vertical-slice deltas, all zod-DTO-driven (OpenAPI regenerates, R-DOC-1):

1. **Migration 007** (`backend/src/db/sql/007_locale.sql`): `ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en'))`; same for `notifications`. Idempotent re-run, safe downgrade; existing rows default `'es'`; rendered history untouched (R-BE-1).
2. **Bilingual templates** (`jobs/templates.ts`): `TEMPLATES: Record<Locale, Record<NotificationType, {title, body}>>` const dictionaries; `renderNotification(type, payload, locale = 'es')`; `user_invited` never renders passwords in either locale (R-NOT-5). Parity + banned-token tests.
3. **emitEvent per-recipient locale** (`notifications/emit.ts`): recipient resolution queries `id, locale` from `users` in-tx; render per recipient; INSERT `(…, title, body, locale)` with the existing `ON CONFLICT (type, reference, channel, user_id) DO NOTHING` (exactly-once preserved); email job still carries only `notificationId` (R-BE-3).
4. **`PATCH /api/auth/me`** (auth module): `patchMeSchema = z.object({locale: z.enum(['es','en'])}).strict()`; service updates `users.locale`; returns `{user}`; `PublicUser` gains `locale` → surfaces in login/refresh/me/users DTOs; `POST /api/users` does NOT accept locale (self-service only — locked). 422 on invalid locale; 401 unauthenticated (R-BE-4).
5. **`PATCH /api/products/:id`** (stock module): `updateProductSchema = z.object({name?, sku?, lowStockThreshold?, active?}).strict().refine(≥1 field)` — mirrors `updateUserSchema` pattern; permission `stock:product_manage`; 404 unknown id; 409 `DUPLICATE_SKU` (subcode in message, ADR-1 archived convention); `active:false` = deactivate, never hard-delete (order-line snapshots intact — R-STK-8). Stock levels for inactive products stay in the ledger; `GET /api/stock` must keep excluding inactive products (verify existing join at apply — R-UI-CRM-5).
6. **Warehouses CRUD** (stock module): `GET /api/warehouses` (permission `stock:stock_read` — the adjust/transfer pickers need it for operator; R-UI-CRM-8 scenario "operator sees them for adjust too") → `{data, pagination}` envelope; `POST` exists; `PATCH /api/warehouses/:id {name}` (`stock:product_manage`, 404/409 duplicate name); `DELETE /api/warehouses/:id` (`stock:product_manage`) → 204 only when NO movement references the warehouse (ledger FK integrity); otherwise 409 with additive subcode `WAREHOUSE_IN_USE` (documented additive subcode — localizeError maps it). With GET /api/warehouses approved, the UI drops the "derived from /api/stock" workaround (spec R-UI-CRM-8 conditional resolved).
7. **Jobs filters** (jobs module): `jobsListQuerySchema` gains `state: z.enum(['created','retry','active','completed','expired','cancelled','failed']).optional()` (pg-boss v12 states — single `pgboss.job` table, per archived design §8 note) and `queue: z.string().trim().max(100).optional()`; repository adds parameterized WHERE clauses (R-NFR-1) + COUNT parity. Server-side filtering replaces the client-side fallback (R-UI-JOB-1 conditional resolved).
8. **SPA serving** (`app.ts` + new `middleware/spaFallback.ts`): ordering = API routers → `express.static(uiDistDir)` → SPA fallback middleware → `notFoundHandler` (JSON 404) → `errorHandler`. Fallback: `if (req.method !== 'GET' || req.path.startsWith('/api/')) return next(); res.sendFile(path.join(uiDistDir, 'index.html'))` — a plain middleware (NOT `app.get('*')`, avoiding Express 5 path-to-regexp v8 wildcard pitfalls). `uiDistDir` is an injectable `createApp` dep (default `../../ui/dist` from `backend/src`) so backend SPA tests point at a temp fixture dir — hermetic, no Vite build required in backend tests (R-BE-5, R-PROD-7). v1 vanilla `ui/index.html` + `app.js` REMOVED at it2 (R-PROD-7 modified).

**Tests**: R-BE-1 (idempotent re-run, defaults, CHECK), R-BE-2 (parity + neutral ES), R-BE-3 (per-recipient locales, exactly-once), R-BE-4 (set/invalid/unauthenticated/DTO surface/docs), R-BE-5 (deep link, /api 404 preserved, static wins, dev parity), R-UI-CRM-7 (PATCH product deactivate + 409), R-UI-CRM-8 (warehouse create/list/patch/delete/409 in-use), R-UI-JOB-1 (server-side state/queue filters).

### ADR-5 — API client contract: fetch wrapper, error normalization, types

**Choice**: `src/api/client.ts` — ported wrapper + single-flight refresh (ADR-3). `apiFetchRaw<T>(path, options) → {status, data}` exposes raw status so callers distinguish 201 (created) from 200 (idempotent replay) — the only replay signal (R-UI-FND-4). `api` object: `get/post/patch/delete/postWithStatus`. Module API modules (`api/{auth,customers,products,warehouses,stock,orders,notifications,audit,users,jobs}.ts`) expose typed functions + **contract types** (`Paginated<T> = {data: T[]; pagination: {page, limit, total, totalPages}}`, `D13 = string` branded by convention, entity interfaces matching the zod DTO shapes — the OpenAPI is the reference; a fixture file mirrors it for tests, R-UI-NFR-6).

**Error normalization**: `ApiClientError {status, code, message}` — `message` is the server's subcode string (e.g. `INSUFFICIENT_STOCK`), never rendered raw. `localizeError(err, t)` maps: `UNAUTHORIZED` → session-expired message (refresh path owns the UX); `FORBIDDEN` → denial message; `NOT_FOUND` → per-resource; `CONFLICT` subcodes (`USERNAME_TAKEN`, `DUPLICATE_EMAIL`, `DUPLICATE_SKU`, `INVALID_STATE`, `INSUFFICIENT_STOCK`, `NEGATIVE_STOCK`, `WAREHOUSE_IN_USE`) → specific strings; `VALIDATION_ERROR` → field-level; `INTERNAL_ERROR`/unknown → generic localized fallback (R-I18N-4).

**Envelope deviation (documented)**: `GET /api/stock` returns `{items: StockRow[]}` — NOT `{data, pagination}` (controller `res.json(result)` — api-surface-gaps #1421). The stock API module types it as `{items: StockRow[]}` explicitly; pagination helpers never applied to it (R-UI-STK-1). All other list endpoints use the standard envelope.

**Formatting (R-UI-ORD-6, D13)**: `formatters.ts` — money display is **float-free by construction**: split the D13 string on `.` (integer part ≤ 1e11 « 2^53 — safe for `Intl.NumberFormat` integer-only grouping); group the integer part with `Intl.NumberFormat(localeTag, {useGrouping: true})`; decimal separator `,` for `es-ES` / `.` for `en-US`; currency `€` suffix ("12,50 €") for `es`, `$` prefix ("$12.50") for `en`. Input parsing (`parseMoney(input, locale)`) strips group separators, maps `,` → `.`, validates scale ≤ 2, returns a normalized `"12.50"` payload string. Dates via `Intl.DateTimeFormat(localeTag)`. Never `Number()` on money.

**Tests**: R-AUTHUI-1 (single-flight), R-UI-FND-4 (replay 200 vs 201), R-I18N-4 mapping, R-UI-ORD-6 (es/en format + round-trip), contract tests asserting method/path/headers/body per module vs fixtures.

### ADR-6 — RBAC in UI: single mirror + parity test against backend source

**Choice**: `src/auth/permissions.ts` — const `ROLE_PERMISSIONS` mirroring `backend/src/permissions/registry.ts` EXACTLY (5 roles × 19 permission codes, incl. `notification:read/update`, `audit:read`; derived `Role`/`RolePermission` types). Two enforcement layers: `PermissionRoute` (routes — redirect + denial toast, R-RBAC-1) and `RoleGate` component (action buttons HIDDEN, never disabled, R-RBAC-2).

**Parity test (the enforcement mechanism)**: the vitest parity test **imports the backend registry directly** — `import { ROLE_PERMISSIONS as BACKEND } from '../../backend/src/permissions/registry.ts'` (monorepo, same TS project family) and asserts deep equality with the UI mirror (R-RBAC-3 "matrix parity"). Backend registry imports nothing browser-hostile (const objects + zod-free); if it ever grows server-only imports, fall back to a JSON fixture + scan (flagged, not expected). Unknown roles → empty permission set (no privileged UI).

**Mid-session role change** (R-RBAC-4): the shell re-fetches `/api/auth/me` on route change (lightweight, keeps sidebar/actions fresh); stale 403 from an endpoint → localized denial toast + next `me` refresh updates visibility (no crash).

**Tests**: R-RBAC-1 (viewer → /users redirect, no request; auditor → /audit read-only), R-RBAC-2 (operator adjust visible / transfer hidden; manager jobs retry), R-RBAC-3 five-role sweep (exact visible set per role) + parity import test, R-RBAC-4 (demoted mid-session, stale 403).

### ADR-7 — Test strategy: vitest + RTL scope, mock fetch as single seam

**Choice**: vitest + @testing-library/react + jsdom + user-event in `ui/` (new contract, R-UI-NFR-6). **Mock fetch client is the single seam**: `api/client.ts` calls `fetch` (global); tests use `vi.stubGlobal('fetch', mockFetch)` with a `tests/helpers/mockFetch.ts` harness that records calls `{method, path, headers, body}` and serves scripted responses from `tests/__fixtures__/api.ts` (response bodies mirroring the zod DTO/OpenAPI shapes — the contract). Unit tests NEVER hit a live backend (locked). Every test name prefixed `R-XXX-N:`; requirement-coverage scan test asserts every requirement ID in this change's specs appears in ≥1 test name (R-UI-NFR-6 scenario, mirrors backend R-NFR-3).

Scope (critical flows get component tests; every module list gets a page test):
- Component: login form (R-UI-FND-1), refresh flow single-flight/bounded (R-AUTHUI-1), route guards (R-RBAC-1), create-form validation (R-UI-CRM-2), confirm-order optimistic (R-UI-ORD-4), i18n toggle (R-I18N-3), RoleGate visibility (R-RBAC-2), ConfirmButton gate (R-UI-CRM-4).
- Page: one per module (dashboard, customers, products, stock, orders, notifications, audit, users, jobs).
- Pure-unit: i18n parity + banned tokens (R-I18N-1/2), localizeError (R-I18N-4), formatters (R-UI-ORD-6), permissions parity (R-RBAC-3), api client contract (R-UI-NFR-6).
- Scans: no-`any` (R-UI-NFR-1), no useMemo/useCallback (R-UI-NFR-4), no dangerouslySetInnerHTML with API data (R-UI-NFR-2), bundle-secret scan on `dist` (R-UI-NFR-3), chunk-split check (R-UI-NFR-5).

Backend delta keeps `node --test` + supertest vs real Postgres (existing harness) — RED→GREEN per R-BE/R-NOT-5 scenarios (ADR-4 test lists). e2e deferred (locked).

**Tests**: R-UI-NFR-6 (refresh-flow scenario, requirement coverage), plus every R-* referenced above.

### ADR-8 — Build/deploy: Vite build in Docker multi-stage, CI gate, single container

**Choice**: `ui/` is the Vite workspace; `npm run build -w ui` → `ui/dist`. **Dockerfile** build stage gains the UI gate: `npm ci` → `npm run typecheck` (both workspaces via root script) → `npm test -w ui` (vitest) → `npm run build -w ui`; runtime stage copies `ui/dist` (`COPY --from=build /app/ui/dist ./ui/dist`); express serves it (ADR-4.8). Single container preserved — the API serves the SPA at `/` (R-PROD-7 modified, R-UI-NFR-7). **Root `package.json` scripts** updated: `typecheck` → backend + ui; `test` → backend + ui; `build` → ui build. **CI** (R-PROD-3 modified): insert after backend `node --test`: `npm run typecheck -w ui` → `npm test -w ui` → `npm run build -w ui`, then Docker build; failing frontend step fails the workflow; backend suite stays green (no regressions). Dev parity: Vite proxy `/api` → `:3000` (R-BE-5 dev parity scenario).

**Evidence** (R-PROD-6, R-UI-NFR-7): `docs/output-ui-it<N>.txt` per iteration (green requirement-referenced tests + demo commands); dashboard-pages evidence updated at it6.

**Alternatives rejected**: separate nginx/static container — locked single-container appliance; CDN-served build — offline appliance requirement.

**Tests**: R-PROD-3 (CI scan + green push scenario via workflow), R-UI-NFR-7 (build + evidence), R-BE-5 (container serves SPA).

## 4. Sequence Diagrams

### 4.1 Refresh flow (R-AUTHUI-1, bounded)

```
UI client                        API
  │ 1. GET /api/orders (Bearer t1)      │
  │ ──────────────────────────────────▶│
  │ ◀────────────── 401 UNAUTHORIZED    │
  │ 2. POST /api/auth/refresh (cookie)  │  ← single-flight: N concurrent 401s share this ONE call
  │ ──────────────────────────────────▶│
  │ ◀───── 200 {accessToken: t2, user}  │
  │ 3. GET /api/orders (Bearer t2, retried)  ← exactly ONE retry
  │ ──────────────────────────────────▶│
  │ ◀──────────────────────── 200 data │
  │ render                              │
  │                                     │
  │ ── refresh fails (401) ──▶ clear token+user → onSessionExpired → /login (no retry, no loop)
  │ ── logout ──▶ POST /api/auth/logout (raw fetch, cookie) → clear memory → /login
```

### 4.2 Atomic order confirm UX (R-UI-ORD-4)

```
Row "Confirm" click → ConfirmButton two-step gate ("Confirmar")  [cancel → no request]
  │
  ├─ optimistic: row → pending state (useOptimistic)
  │ POST /api/orders/:id/confirm (Idempotency-Key: fresh UUID)
  │   ├─ 200 → row confirmed + success toast
  │   │        → refetch stock levels + movements + notification badge (R-UI-DSH-3)
  │   ├─ 409 INSUFFICIENT_STOCK → optimistic rolled back; localized toast
  │   │        ("Stock insuficiente para confirmar el pedido"); order stays draft;
  │   │        refetch stock (levels unchanged) + movements (zero order_out rows) ← zero side effects shown
  │   ├─ 409 INVALID_STATE → refresh order row from server (confirmed elsewhere)
  │   └─ 401 → refresh flow (ADR-3) → retry once
```

## 5. File Tree

```
capstone/
├── package.json                  # MODIFY: typecheck/test → both workspaces; + build → ui
├── Dockerfile                    # MODIFY: build stage + ui typecheck/test/build; runtime copies ui/dist
├── .github/workflows/ci.yml      # MODIFY: + ui typecheck → ui test → ui build before docker build
├── docs/output-ui-it<N>.txt      # NEW per iteration (evidence)
├── backend/src/
│   ├── app.ts                    # MODIFY: uiDistDir dep + SPA fallback wiring (ADR-4.8)
│   ├── middleware/spaFallback.ts # NEW
│   ├── db/sql/007_locale.sql     # NEW (R-BE-1)
│   ├── jobs/templates.ts         # MODIFY: bilingual dictionaries + locale param
│   ├── modules/notifications/emit.ts   # MODIFY: per-recipient locale (R-BE-3)
│   ├── modules/auth/{dto,service,repository,controller,routes}.ts  # MODIFY: patchMe + PublicUser.locale
│   ├── modules/stock/{dto,service,repository,controller,routes}.ts # MODIFY: products PATCH + warehouses CRUD
│   ├── modules/jobs/{dto,repository,service,controller,routes}.ts  # MODIFY: state/queue filters
│   ├── openapi/registry.ts       # MODIFY: register new paths (auto from DTOs)
│   └── tests/                    # MODIFY: templates/auth/notifications/stock/jobs/ui/docs tests; NEW locale-migration assertions
└── ui/                           # REPLACES vanilla v1 files (removed at it2)
    ├── package.json              # NEW: + vitest, @testing-library/react, jsdom, user-event, compiler plugin
    ├── vite.config.ts            # NEW: react+compiler plugin, /api proxy, vitest config
    ├── tsconfig.json             # NEW: strict (noUncheckedIndexedAccess, exactOptionalPropertyTypes, erasableSyntaxOnly)
    ├── index.html
    └── src/
        ├── main.tsx  App.tsx     # routes (lazy governance pages)
        ├── styles/index.css      # dark theme #0f1115 / indigo #4f46e5
        ├── api/client.ts  api/types.ts  api/{auth,customers,products,warehouses,stock,orders,notifications,audit,users,jobs}.ts
        ├── auth/AuthContext.tsx  auth/permissions.ts
        ├── i18n/{LocaleContext,useTranslation,localizeError,formatters,types}.ts(x)  i18n/locales/{es,en}.ts
        ├── hooks/{useResource,usePagination,useDebouncedValue}.ts
        ├── components/{Layout,Sidebar,ProtectedRoute,PermissionRoute,RoleGate,DataTable,Pagination,Modal,FormField,Badge,EmptyState,ErrorState,LoadingState,LocaleToggle,ConfirmButton,ToastProvider,MoneyText}.tsx
        ├── modules/{crm,stock,orders,governance}/components/...   # module-scoped components
        └── pages/{Login,Dashboard,Customers,Products,Stock,Orders,OrderDetail,Notifications,Audit,Users,Jobs}Page.tsx
    └── tests/
        ├── helpers/mockFetch.ts  __fixtures__/api.ts
        ├── api-client.test.ts  auth.test.tsx  rbac.test.tsx  i18n.test.ts  formatters.test.ts
        ├── dashboard.test.tsx  customers.test.tsx  products.test.tsx  warehouses.test.tsx
        ├── stock.test.tsx  orders.test.tsx  notifications.test.tsx  audit.test.tsx
        ├── users.test.tsx  jobs.test.tsx  nfr.test.ts
```

## 6. i18n Key Catalog Structure

UI dictionaries — flat dotted keys, namespaces per module (examples; pinned at it2):

```
common.{appName, save, cancel, confirm, edit, delete, deactivate, activate, search, all, filter,
        loading, retry, back, close, actions, prev, next, pageOf, noRecords, errorRetry}
auth.{login.title, login.username, login.password, login.submit, login.invalidCredentials,
      login.sessionExpired, logout, denied}
nav.{dashboard, customers, products, stock, orders, notifications, audit, users, jobs}
dashboard.{status.title, status.ok, status.degraded, kpi.customers, kpi.products, kpi.orders,
           lowStock.title, lowStock.none, recentNotifications.title, refresh}
crm.{customer.listTitle, customer.searchPlaceholder, customer.statusFilter, customer.create,
     customer.edit, customer.deactivate, customer.reactivate, customer.confirmDeactivate,
     customer.duplicateEmail, customer.notFound, customer.phone, customer.notes, customer.status,
     product.listTitle, product.sku, product.lowStockThreshold, product.inactive, product.duplicateSku,
     warehouse.listTitle, warehouse.create, warehouse.name, warehouse.duplicateName,
     warehouse.inUse, warehouse.confirmDelete}
stock.{levels.title, levels.low, levels.level, movements.title, adjust.title, adjust.quantity,
       adjust.reason, adjust.insufficient, transfer.title, transfer.from, transfer.to,
       transfer.warehousesMustDiffer, transfer.insufficient, reasonMin}
orders.{list.title, state.draft, state.confirmed, state.cancelled, create.title, create.customer,
        create.addLine, create.removeLine, create.atLeastOneLine, create.qtyMin, create.priceScale,
        create.lineTotal, confirm.title, confirm.pending, confirm.insufficient, confirm.invalidState,
        cancel.title, cancel.reason, cancel.reasonMin, total, detail.notFound}
notifications.{title, unreadOnly, markRead, empty, type.orderConfirmed, type.orderCancelled,
               type.lowStock, type.stockAdjusted, type.stockTransferred, type.userInvited, type.jobFailed}
audit.{title, entity, action, from, to, payload, actor, timestamp}
users.{title, create, role, active, inactive, usernameTaken, passwordStrength, invitationSent,
       selfDeactivateBlocked, fullName, email, password}
jobs.{title, queue, state, attempts, retry, retryQueued, state.created, state.retry, state.active,
      state.completed, state.expired, state.cancelled, state.failed, notFound}
errors.{unauthorized, forbidden, notFound, conflict.usernameTaken, conflict.duplicateEmail,
        conflict.duplicateSku, conflict.invalidState, conflict.insufficientStock,
        conflict.negativeStock, conflict.warehouseInUse, validation, internal, unknown}
```

Backend templates namespace is **separate** (`backend/src/jobs/templates.ts`): `{es, en}` dictionaries keyed by the 7 notification types — no code sharing with the UI (separate TS projects); parity + neutral-Spanish enforced by backend tests (R-BE-2).

## 7. Component Inventory (shared)

| Component | Purpose | Spec |
|---|---|---|
| `DataTable<T>` | columns config, rows, key, sortable=false; slots loading/empty/error | R-UI-FND-3 |
| `Pagination` | page/limit/total/totalPages controls (localized labels) | R-UI-CRM-1 |
| `Modal` | form dialogs (create/edit), focus trap, ESC/backdrop close | R-UI-CRM-2 |
| `FormField` | label + input + localized error (field-level 422 mapping) | R-I18N-4 |
| `Badge` | state/role/low-stock/active badges (localized labels) | R-UI-STK-1, R-UI-ORD-1 |
| `EmptyState` | localized "No hay registros" + icon | R-UI-FND-3 |
| `ErrorState` | localized error + retry button | R-UI-FND-3 |
| `LoadingState` | spinner/skeleton while fetching | R-UI-FND-3 |
| `LocaleToggle` | ES/EN switch (pre-auth localStorage / post-auth PATCH) | R-I18N-3 |
| `RoleGate` | hide actions per permission (never disabled) | R-RBAC-2 |
| `PermissionRoute` | route guard → /dashboard + denial toast | R-RBAC-1 |
| `ConfirmButton` | two-step atomic confirm (button → "Confirmar" → request; cancel fires nothing) | R-UI-CRM-4, R-UI-ORD-4 |
| `ToastProvider` | localized success/conflict/error toasts | R-UI-FND-3 |
| `MoneyText` | D13 string → locale currency display (float-free) | R-UI-ORD-6 |
| `DebouncedSearchInput` | q param with debounce | R-UI-CRM-1 |

## 8. Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Frontend unit | i18n parity/banned tokens, localizeError, formatters, permissions parity (imports backend registry) | vitest, pure functions |
| Frontend component | login, refresh single-flight, guards, create-form validation, confirm-order optimistic, toggle, RoleGate, ConfirmButton | vitest + RTL + jsdom + user-event, mock fetch seam |
| Frontend page | one per module list/detail | RTL, mock fetch fixtures |
| Frontend scans | no-any, no useMemo/useCallback, no dangerouslySetInnerHTML, dist secret scan, chunk split, requirement-ID coverage | vitest source/dist scans |
| Backend delta | R-BE-1..5, R-NOT-5, R-UI-CRM-7/8, R-UI-JOB-1 contracts; templates parity + neutral ES | node:test + supertest vs real Postgres (existing harness) |
| Evidence | `docs/output-ui-it<N>.txt` per iteration; dashboard update at it6 | scripted suite run + appended summary |

Iteration → suite: it1 backend delta (R-BE, R-NOT-5, delta endpoints) · it2 foundation (R-AUTHUI, R-UI-FND, R-RBAC, R-I18N, R-UI-NFR infra) · it3 dashboard+CRM (R-UI-DSH, R-UI-CRM) · it4 stock+orders (R-UI-STK, R-UI-ORD) · it5 governance (R-UI-NOT/AUD/USR/JOB) · it6 polish+evidence (R-UI-NFR full, R-PROD-3/7, docs) — cumulative suite green each iteration.

## 9. Migration / Rollout

Migration 007 additive + idempotent (safe re-run/downgrade — R-BE-1). Backend deltas are additive endpoints; no breaking changes; existing 229 tests stay green (no regressions — R-PROD-3). Rollback: PR-per-iteration git revert; previous Docker tag redeploy; v1 vanilla UI files removed at it2 (git history retains them — revert restores `/` serving).

## 10. Open Questions

- [ ] `GET /api/stock` inactive-product exclusion: verify the current join at apply; if it does NOT exclude, the delta adds the filter (small, additive, covered by R-UI-CRM-5 scenario).
- [ ] `WAREHOUSE_IN_USE` subcode: additive to the error contract — confirm it needs no spec amendment beyond this design note (localizeError + parity test cover it).
- [ ] Vitest `environment: jsdom` global vs per-file (`// @vitest-environment jsdom`) for pure-unit files — apply-phase choice, no design impact.
- [ ] `Intl.NumberFormat` currency choice (EUR for es / USD for en) is fixed by R-UI-ORD-6 examples — no ambiguity.