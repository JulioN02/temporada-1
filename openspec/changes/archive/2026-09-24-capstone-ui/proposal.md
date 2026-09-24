# Proposal: CAPSTONE-UI — Full React 19 Frontend for the Business Operations Platform

Change: `capstone-ui` · Project: `temporada-1` · Phase: propose · Artifact store: hybrid · Date: 2026-09-21 · Upstream: capstone v1 (archived 2026-09-21, 229/229 tests, PASS WITH WARNINGS)

## Intent

The v1 verification UI (`capstone/ui/index.html` + `app.js`, 322 lines, read-only tables, 2 buttons, English-only) is **insufficient** — user explicitly rejected it: "dashboard plano sin funcionalidades, módulos ni cosas prácticas". This change replaces it with a **full React 19 SPA** that demonstrates the platform's real capabilities (RBAC, atomic order↔stock, notifications, audit) and delivers the employability/portfolio value the capstone promises. Backend API is complete and verified — the UI must consume it as-is, with only a tiny justified backend i18n delta.

## Scope

### In Scope
- **React 19 SPA** (Vite build, pattern: inventory-stock frontend — React 19, Vite 6, react-router-dom 7; NOT the v1 "minimal UI"): login, sidebar layout + module navigation, Dashboard, Customers CRUD, Products CRUD (+warehouses), Stock (levels + movements + adjust + transfer), Orders (create → confirm atomic → cancel with reason), Notifications (list + mark read + unread badge), Audit (filterable, admin/auditor), Users (admin invite/create), Jobs (list/retry)
- **i18n ES/EN across the WHOLE system**: UI chrome + module labels + backend notification templates (in-app) + SMTP email templates; Spanish = NEUTRAL (no voseo/Rioplatense — AGENTS.md hard preference); preference persisted (localStorage + user record), default from browser/URL
- **Role-aware UI** (RBAC, 5 roles / 19 permission codes from backend registry): viewer read-only; operator operations (customers write, orders write, stock adjust/transfer); manager + products/warehouses manage + jobs retry; admin + users + audit; auditor read-only + audit. Hide modules AND actions per role — not just routes
- **Token handling**: access token in memory ONLY (never localStorage — XSS surface); refresh via httpOnly cookie; 401 → refresh → retry once (bounded, no infinite loops) → logout on refresh failure
- **Dark theme** consistent with current UI (dark #0f1115, indigo #4f46e5 accent) — portfolio polish
- **Evidence**: docs/output-ui-*.txt per iteration, README update, dashboard-pages update, frontend test suite

### Out of Scope
- No breaking backend API changes (only additive i18n delta, below)
- No multi-tenancy, PDFs, real-time websockets (polling/on-demand refresh is fine), mobile app, no TanStack Query (plain fetch client — precedent), no Playwright e2e (deferred follow-up)

### Backend delta (tiny, additive — justified)
- Migration 007: `users.locale` + `notifications.locale` (`CHECK locale IN ('es','en')`, defaults 'es')
- `templates.ts`: bilingual dictionaries, `render(type, payload, locale)`
- emitEvent resolves recipient locale (stored user preference — see Approach) and renders at emit time (keeps R-NOT-5 immutable-snapshot contract)
- `PATCH /api/auth/me {locale}` (self-service) + locale in `/api/auth/me`, login and users DTOs
- SPA serving: express serves `ui/dist` + history-fallback (non-/api GET → index.html); `/api` 404 JSON preserved
- OpenAPI regenerates automatically from zod DTOs (R-DOC-1)

## Capabilities (contract with sdd-spec — openspec/specs/ does not exist; all NEW)

- `ui-foundation`: SPA shell, routing, auth session (login/refresh-retry/logout/me-restore), ProtectedRoute, sidebar + RBAC visibility, dark theme, i18n infra (context, toggle, persistence, error localization), empty/error states, toasts
- `ui-dashboard`: KPI cards (counts, health/status), low-stock alerts, recent notifications
- `ui-crm`: customers CRUD/search/filter + products/warehouses CRUD, validation, localized API errors
- `ui-stock-orders`: stock levels/movements/adjust/transfer; orders list/detail/create (lines, D13)/confirm (atomic, optimistic)/cancel (reason ≥10)
- `ui-governance`: notifications (read/unread), audit (filterable), users (invite/create/activate), jobs (list/retry)
- `notification-i18n` (backend delta): bilingual templates, locale on user/notification rows, self-service locale endpoint

## Approach

- **Structure**: Vite 6 + React 19 + react-router-dom 7 + @vitejs/plugin-react + babel-plugin-react-compiler (React Compiler ON — no useMemo/useCallback per react-19 skill; Server Components N/A, client SPA). TS strict (same flags as backend: noUncheckedIndexedAccess, exactOptionalPropertyTypes). Layout `src/{api,auth,components,i18n,modules,pages,styles}`; const-types pattern (never bare string unions); `import type` for types.
- **Same-origin strategy** (precedent): Vite dev proxy `/api` → :3000; express serves `dist/` in prod; NO CORS. Port inventory-stock `api/client.ts` (in-memory token, 401→refresh→retry once→onSessionExpired), `ProtectedRoute`/`RoleGate`, `AuthContext`.
- **i18n architecture — homegrown dictionaries** (const `es.ts`/`en.ts`, `MessageKey = keyof typeof en` — compile-time parity; `LocaleContext` + `useTranslation` + `localizeError` mapping API error codes). **Rejected i18next**: 2 locales, flat keys, zero deps (supply-chain + bundle), proven precedent in inventory-stock; i18next earns its place at 4+ locales/plurals/interpolation. Neutral-Spanish checklist enforced in review.
- **Backend template i18n — stored user locale wins** (users.locale, default 'es'): Accept-Language rejected (email recipients send no headers), per-event context rejected (inconsistent). Templates render at emit in recipient's locale; locale stored on notification row (provenance); UI displays stored snapshot (no client re-render — keeps single source of truth server-side).
- **Build/deploy**: Vite build → `ui/dist`; Dockerfile build stage runs `npm run build -w ui`; runtime copies dist; single-container appliance preserved; CI adds ui typecheck + tests + build.
- **Testing — ADD vitest + @testing-library/react + jsdom + user-event** (justified: flagship, employability evidence, regression protection for refresh flow + atomic confirm; inventory-stock had no runner — this closes that gap). Scope: api client refresh/retry (bounded), i18n dictionary parity test (es/en key symmetry — R-NOT-2 parity precedent), RBAC visibility, critical page tests (login, order confirm, stock adjust validation). e2e deferred.

## Preliminary Requirements (spec expands)

- **R-UI-FND-1..8**: login (localized identical-401 message); token memory-only; 401→refresh→retry once→logout; session restore via /api/auth/me on boot; ProtectedRoute preserves intended route; logout clears state + calls API; language toggle applies to ALL UI strings, persists localStorage, defaults browser/URL, syncs `document.lang`; locale pushed to backend when authenticated; i18n parity test green.
- **R-UI-RBAC-1..4**: sidebar modules per role (mirror of backend PERMISSIONS registry); action buttons hidden per role (viewer sees zero write buttons); unauthorized route → redirect; auditor sees audit only in read mode.
- **R-UI-DSH-1..3**: status/health cards; counts (customers/products/orders); low-stock + unread-notification alerts; on-demand refresh.
- **R-UI-CRM-1..5**: customers list/search/status-filter/pagination; create/edit/deactivate (dup email 409 localized); products CRUD (SKU, threshold, active — never hard-delete); warehouses CRUD (manager+).
- **R-UI-STK-1..5**: levels table with low-stock badge; movements history (filterable); adjust (qty>0, reason ≥10, idempotency key per submit); transfer (from≠to, localized INSUFFICIENT_STOCK); 409 states zero side effects surfaced.
- **R-UI-ORD-1..6**: list w/ state filter + pagination; create with dynamic line editor (product picker, qty≥1, D13 unit price); idempotency key per submit (no double-create); confirm with optimistic UI → success/409 INSUFFICIENT_STOCK localized; cancel with reason ≥10; D13 formatted per locale (Intl).
- **R-UI-NOT-1..3**: list + read/unread filter; mark read idempotent; unread badge in nav.
- **R-UI-GOV-1..5**: audit filterable table (admin/auditor); users invite/create (username/fullName/email/role/locale), activate/deactivate; jobs list (queue/state/attempts) + retry (manager+); failure states visible.
- **R-UI-NFR-1..6**: strict tsc; no `any`; const-types; React Compiler (no useMemo/useCallback); no dangerouslySetInnerHTML with user data; no secrets in client bundle; bounded refresh; both locales green in suite; build passes CI.

## Delivery Strategy (TDD, vertical slices — each iteration a complete, verifiable flow)

1. **it1 — backend i18n delta** (unblocks bilingual notifications): migration 007, bilingual templates, emitEvent locale, users/auth DTO + PATCH /api/auth/me, SPA fallback + dist serving; backend RED→GREEN (229 + new tests)
2. **it2 — UI foundation**: Vite scaffold, theme, i18n infra + parity test, api client + auth (login/refresh/logout/me), Layout + sidebar, toggle; vitest+RTL setup; tests: login + refresh-retry
3. **it3 — dashboard + CRM**: KPI cards; customers CRUD; products + warehouses CRUD
4. **it4 — stock + orders** (showpiece): levels/movements/adjust/transfer; orders create/confirm/cancel; optimistic confirm + atomic-error UX
5. **it5 — governance**: notifications, audit, users, jobs
6. **it6 — polish + evidence**: RBAC final pass (all 5 roles), empty/error states, toasts, README, output-ui-*.txt, dashboard update, Docker + CI integration

PR strategy: branch per iteration (`ui-it1`..`ui-it6`), chained PRs vs main; merge gate = backend suite + frontend suite + tsc + build + evidence doc. Estimated size: ~6–8k LOC frontend, ~300–500 LOC backend delta.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Refresh-flow complexity (concurrent 401s, races) | Med | Port proven inventory-stock client; single-flight refresh; bounded retry; dedicated tests |
| i18n scope creep (UI + templates + emails + errors) | High | Dictionaries frozen at it2; parity test; neutral-Spanish review checklist; design-critic |
| React 19 / Vite 6 / Compiler version drift | Low | Pin versions from inventory-stock; context7 verify at apply |
| API contract gaps found during UI work | Med | Report as deltas; additive only; no breaking changes |
| First vitest+RTL setup in repo | Med | Spike in it2; scope = critical flows only |
| Strict TS + React 19 patterns (ref prop, use()) | Med | react-19 + typescript skills enforced in apply |

## Rollback Plan

PR-per-iteration git revert; migration 007 additive + idempotent (safe downgrade); single container unchanged (previous Docker tag redeploy); v1 vanilla UI files retained in git history until it2 replaces them — revert restores `/` serving.

## Dependencies

inventory-stock frontend (port source: client, i18n, RouteGate pattern) · React 19 + react-dom 19 · Vite 6 + @vitejs/plugin-react 4 · react-router-dom 7 · vitest + @testing-library/react + jsdom · babel-plugin-react-compiler · backend v1 API (unchanged contract + i18n delta).

## Success Criteria

- [ ] All 6 iterations green: backend suite (229 + new bilingual tests) + frontend suite + strict tsc + vite build; evidence docs/output-ui-*.txt
- [ ] Demo passes in ES and EN: login → customers/products CRUD → stock adjust/transfer → order create → confirm (atomic, 409 shown cleanly) → bilingual in-app + email notification → audit rows → jobs retry
- [ ] RBAC: each of the 5 roles sees exactly its permitted modules/actions
- [ ] Session survives >15 min via silent refresh; refresh failure → clean logout
- [ ] Docker image serves the SPA at `/` (single container); CI green
- [ ] README + dashboard-pages evidence updated

## Open Questions (user input)

1. **Default locale 'es' vs 'en'**: recommend 'es' (neutral Spanish product default, aligns with hard preference) — existing notification history keeps its rendered English snapshot; only new emits change. Confirm.
2. Language toggle while **not authenticated** persists localStorage only (backend push needs login) — acceptable?
3. **Warehouses CRUD** folded into Stock module (manager+) — confirm placement.
4. Playwright e2e deferred to follow-up iteration — confirm.