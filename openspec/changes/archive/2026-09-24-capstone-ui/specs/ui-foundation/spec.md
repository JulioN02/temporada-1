# Specification: UI Foundation (NEW — React 19 SPA shell, auth session, RBAC, NFRs)

Change: `capstone-ui` · Project: `temporada-1` · Phase: **spec** · Artifact store: **hybrid** · Date: 2026-09-21
Upstream: `proposal.md` (2026-09-21) · Downstream: design. Replaces v1 vanilla verification UI (R-PROD-7 MODIFIED in `notification-i18n/spec.md`). Stack locked: React 19 + Vite 6 + react-router-dom 7 + React Compiler + strict TS (pattern: inventory-stock frontend). Vitest + React Testing Library is the frontend test runner (new contract).

## Purpose

Define the SPA shell contract: routing + auth session (login, silent refresh, logout, boot restore), protected/role-aware navigation, and the cross-cutting NFRs that every module depends on. Every requirement maps 1:1 to a requirement-referenced vitest/RTL test.

# 1. Auth session & shell (R-AUTHUI, R-UI-FND)

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

- **Scenario: admin nav** — GIVEN admin WHEN the shell renders THEN the 9 sidebar modules from the R-RBAC-3 matrix appear (warehouses folded into Stock; Stock's 3 tabs are page-level, not sidebar entries). F2 (verify W-2): wording aligned with the matrix — earlier draft said "11".
- **Scenario: viewer nav** — GIVEN viewer WHEN the shell renders THEN only Dashboard, Customers, Products, Stock, Orders, Notifications appear and zero write actions are visible anywhere in the shell.

### Requirement: R-UI-FND-3 — Loading, empty, error states and toasts

Every module list/detail MUST render a distinct loading state (skeleton/spinner) while fetching, a localized empty state ("No hay registros" / "No records") when the collection is empty, and a localized error state with retry when a request fails (except 401, which routes to the refresh flow). Mutation results MUST surface via localized toasts (success, conflict, error).

- **Scenario: empty list** — GIVEN `GET /api/customers` returns `{data: [], pagination: {total: 0}}` WHEN the Customers page loads THEN the localized empty state renders, not a table with zero rows.
- **Scenario: network error** — GIVEN `GET /api/products` rejects (500) WHEN the page loads THEN the localized error state renders with a retry button that re-fetches.

### Requirement: R-UI-FND-4 — Idempotency-Key per mutation submit

Every mutating form that maps to an idempotent backend endpoint (order create/confirm, stock adjust/transfer) MUST generate a fresh `Idempotency-Key` (UUID) per user submit and send it in the header. A duplicate submit (same form, same key) MUST NOT create a second resource; a 200 replay response MUST be treated as success without double-rendering.

- **Scenario: double-click create** — GIVEN the user double-clicks submit WHEN the first request succeeds THEN the second (same key) returns 200 replay and the list shows exactly one new row.
- **Scenario: fresh key per submit** — GIVEN the same form submitted twice as separate actions THEN two distinct keys are sent and two resources are created (per backend semantics).

# 2. RBAC (R-RBAC)

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

# 3. Cross-cutting NFRs (R-UI-NFR)

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

# Test contract notes (apply phase)

- One test file per module; test names prefixed `R-XXX-N:`.
- i18n parity test lives in `notification-i18n` (R-I18N-1); RBAC five-role sweep in R-RBAC-3.
- Mock fetch client is the single seam: contract tests assert request method/path/headers/body and response shapes per the v1 OpenAPI + this delta (R-BE-*).