# Delta for System-wide i18n + Backend Delta (notification-i18n)

Change: `capstone-ui` · Project: `temporada-1` · Phase: **spec** · Artifact store: **hybrid** · Date: 2026-09-21
Base spec: `openspec/specs/capstone/spec.md` (archived 2026-09-21, 229/229 green). This delta MODIFIES R-NOT-5, R-PROD-7, R-PROD-3 and ADDS the i18n contract (R-I18N) + backend delta requirements (R-BE). Backend contract is otherwise UNCHANGED (locked decision); the delta is additive and non-breaking.

## MODIFIED Requirements

### Requirement: R-NOT-5 — Bilingual templates per type, rendered at emit

Each type MUST have a text template rendering `title` + `body` from its payload **in the recipient's stored locale** (`users.locale`, default `'es'`; fallback to `'es'` when the row is missing or invalid); email body MUST NOT contain secrets (tokens, passwords). Templates MUST exist in BOTH locales for EVERY type with key parity (R-BE-2). Rendering happens ONCE at emit time (immutable snapshot stored on the notification row, including the `locale` it was rendered in); the worker MUST NOT re-render — history keeps its rendered snapshot even if the recipient's locale later changes.
(Previously: English-only templates rendered once at emit time.)

- **Scenario: order_confirmed template ES** — GIVEN a recipient with `locale:'es'` WHEN an order confirm event emits THEN the row title/body are neutral Spanish and contain order id + total string.
- **Scenario: order_confirmed template EN** — GIVEN a recipient with `locale:'en'` WHEN the same event emits THEN the row renders in English (per-recipient rendering; two recipients with different locales get two differently-rendered rows).
- **Scenario: fallback es** — GIVEN a recipient whose stored locale is NULL/invalid WHEN emit THEN the row renders in 'es' and `locale` stores `'es'`.
- **Scenario: no secrets** — GIVEN any template in either locale THEN rendered body excludes credentials by construction (asserted for `user_invited` in both locales: no password value).
- **Scenario: history immutable** — GIVEN a notification row rendered in EN at emit THEN the user switches to 'es' and the row still displays its stored English title/body (R-UI-NOT-1).

### Requirement: R-PROD-7 — Full React SPA served by the appliance

The appliance MUST serve the React 19 SPA (`ui/dist`, built by Vite) at `/` with history-fallback for non-API routes; the SPA MUST prove all platform flows end-to-end: login, customers/products/warehouses CRUD, stock adjust/transfer, order create/confirm/cancel (atomic), notifications (bilingual), audit, jobs retry. The v1 vanilla verification UI (`ui/index.html` + `app.js`) is REPLACED and MUST NOT be served.
(Previously: lightweight non-React verification page with read views only; "No React in v1 (locked)".)

- **Scenario: end-to-end** — GIVEN seeded data WHEN SPA login (admin) THEN customers/products/stock/orders lists render from the API and a confirm-order flow completes.
- **Scenario: no vanilla files** — GIVEN the built container THEN `/` serves the SPA shell, not `app.js` (old files removed from the repo at it2).

### Requirement: R-PROD-3 — CI pipeline with frontend gate

CI (on push/PR, `.github/workflows/ci.yml`) MUST run: install → migrate test DB → backend `tsc --noEmit` → backend `node --test` → **UI typecheck (`npm run typecheck -w ui`) → UI tests (`npm test -w ui`, vitest) → UI build (`npm run build -w ui`)** → Docker build → publish image to GitHub Container Registry (`ghcr.io`). A failing frontend step MUST fail the workflow; the backend suite MUST remain green with zero regressions.
(Previously: install → migrate → tsc → node --test → Docker build → publish.)

- **Scenario: green push** — GIVEN passing backend + frontend suites THEN workflow completes AND image tag published to GHCR.
- **Scenario: failing UI test** — GIVEN a failing vitest test THEN workflow fails (red) AND no publish.
- **Scenario: no backend regression** — GIVEN the full backend suite (229 + new R-BE/R-NOT-5 tests) THEN all pass.

## ADDED Requirements

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

A `localizeError` mapping MUST translate backend error codes to localized friendly messages: `UNAUTHORIZED` → "Sesión expirada, inicia sesión de nuevo" / "Session expired, please sign in again" (refresh flow path); `FORBIDDEN` → "No tienes permiso para esta acción" / "You do not have permission"; `NOT_FOUND` → per-resource messages; `CONFLICT` subcodes (`USERNAME_TAKEN`, `DUPLICATE_EMAIL`, `DUPLICATE_SKU`, `INVALID_STATE`, `INSUFFICIENT_STOCK`, `NEGATIVE_STOCK`) → specific localized strings (used by R-UI-CRM/R-UI-STK/R-UI-ORD scenarios); `VALIDATION_ERROR` → field-level messages; `INTERNAL_ERROR` → "Ocurrió un error inesperado" / "An unexpected error occurred". Unknown codes MUST fall back to a generic localized message; raw server messages MUST NOT be shown to users.

- **Scenario: conflict mapping** — GIVEN an API error `{code:"INSUFFICIENT_STOCK"}` WHEN `localizeError` runs with 'es' THEN the neutral Spanish stock message returns.
- **Scenario: unknown code** — GIVEN `{code:"SURPRISE"}` WHEN mapped THEN the generic localized fallback returns (never the raw message).
- **Scenario: parity** — GIVEN the error map in both locales THEN the same code sets exist in each (key parity, R-I18N-1).