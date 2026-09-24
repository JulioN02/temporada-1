# Specification: UI Governance — Notifications, Audit, Users, Jobs (NEW)

Change: `capstone-ui` · Project: `temporada-1` · Phase: **spec** · Artifact store: **hybrid** · Date: 2026-09-21
Upstream: proposal (capability `ui-governance`) · Downstream: design.

## Purpose

Define the governance module contracts: notifications (read/unread, mark-read, badge), audit (filterable, admin/auditor), users (admin invite/create/activate), jobs (manager+ list/retry). All list views follow the pagination + empty/loading/error contract (R-UI-FND-3).

# 1. Notifications (R-UI-NOT)

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

# 2. Audit (R-UI-AUD)

### Requirement: R-UI-AUD-1 — Audit trail table (admin/auditor only)

The Audit page MUST render `GET /api/audit?entity=&action=&from=&to=&page=&limit=` newest-first (columns: timestamp, actor, entity, entityId, action, payload) with filters for entity and action, plus date-from/to inputs. Only `audit:read` roles (admin/auditor) reach it (R-RBAC-1); the payload column MUST render as JSON text (never executed, R-UI-NFR-2). An operator visiting the route MUST be redirected (R-RBAC-1 scenario).

- **Scenario: filter** — GIVEN audit rows WHEN `entity=customer&action=customer.create` THEN only matching rows render.
- **Scenario: 403 guard** — GIVEN operator role WHEN navigating to /audit THEN redirect + denial toast, no request.
- **Scenario: payload text** — GIVEN a payload containing `<script>` WHEN rendering THEN literal text displays.

# 3. Users (R-UI-USR)

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

# 4. Jobs (R-UI-JOB)

### Requirement: R-UI-JOB-1 — Jobs list (manager+)

The Jobs page MUST render `GET /api/jobs?page=&limit=` (columns: id, queue, state, attempts, timestamps). **The verified API exposes no `state`/`queue` query filters** (jobs DTO is page/limit only — checked) — therefore state filtering MUST be client-side over the returned page (or descoped at design if an additive `state` filter delta is approved); the page MUST still show a state column with localized labels and the retry action per row. Only manager/admin see the module.

- **Scenario: list** — GIVEN jobs WHEN loaded THEN queue/state/attempts columns render; failed jobs are visually distinct.
- **Scenario: guard** — GIVEN operator WHEN navigating to /jobs THEN redirect + denial toast (no `jobs:job_read`).

### Requirement: R-UI-JOB-2 — Retry job (manager+)

Retry MUST be a confirm-gated action on failed/archived jobs calling `POST /api/jobs/:id/retry`; success → toast "Trabajo reencolado" + row refresh. 404 renders the localized not-found state.

- **Scenario: retry** — GIVEN a dead-lettered job WHEN confirm-retry THEN the API call fires, toast renders, and the row's state refreshes.
- **Scenario: unknown id** — GIVEN a stale row WHEN retry THEN localized 404 renders and the list refreshes.