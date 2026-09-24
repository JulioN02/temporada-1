# Business Operations Platform (BOP v1)

**The capstone of Temporada 1.** A serious, integrated operations platform:
auth/RBAC, CRM, orders with an **atomic confirm → stock ledger → notifications
→ email-job** transaction, pg-boss jobs, append-only audit, OpenAPI docs, a full
**React 19 SPA with ES/EN i18n**, and a production Docker appliance — all built
with strict TDD (requirement-referenced tests, evidence per iteration).

> "Construí una plataforma de operaciones donde workflows automatizados orquestan
> inventario, pedidos y notificaciones." — API-first, single backend package, two
> entrypoints (`server.ts` API + `worker.ts` jobs), one React SPA workspace.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node ≥ 22 (native TypeScript, no build step) |
| API | Express 5 · zod v4 (fail-fast env + DTOs) |
| Frontend | **React 19 SPA** · Vite 6 · react-router-dom 7 · React Compiler · TypeScript strict (capstone-ui) |
| i18n | ES/EN const dictionaries, parity + neutral-Spanish gates, per-user locale (self-service) |
| DB | PostgreSQL 16 (raw parameterized SQL, repository pattern) |
| Money | D13 exact string math (`lib/decimal.ts`, never JS float) |
| Jobs | pg-boss v12 — durable queue, retry/backoff/dead-letter, same-tx enqueue |
| Email | nodemailer, **worker-only** (request path never sends — enforced by scan) |
| Docs | OpenAPI 3.1 generated from the zod DTOs (self-hosted Swagger UI, offline) |
| Observability | pino JSON logs (redact), `/api/health` (public) + `/api/status` (authed) |
| Delivery | Multi-stage Docker (non-root, HEALTHCHECK, ui/dist baked) · docker compose appliance · CI/CD → GHCR |

## Quickstart (full appliance, offline — dev-only credentials)

```bash
docker compose up -d --build
```

Then:

- **React SPA** → http://localhost:3000 (login at `/`; demo data seeded by `init/`)
- Swagger UI → http://localhost:3000/api/docs
- Health → http://localhost:3000/api/health
- Mailpit (dev SMTP sink) → http://localhost:8025

> ⚠️ The compose defaults (`postgres:postgres`, `dev-only-*` secrets) are
> **dev-only**. For any shared/production environment override every variable
> via a real `.env` — see [`docs/deploy-oracle.md`](docs/deploy-oracle.md).

Create the first admin (dev-only credentials — change before any real use):

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","fullName":"Admin","email":"admin@example.com","role":"admin","password":"<12+ chars, letter+digit>"}'
# then login:
curl -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'
```

Local dev (without Docker for the API): `docker compose up -d db mailpit` →
`npm ci` (root workspaces) → `npm run dev -w backend` + `npm run dev -w ui`
(SPA on http://localhost:5173, `/api` proxied to :3000).

## The React SPA (capstone-ui)

Role-aware, fully localized (ES default / EN toggle) shell with dark theme:

| Module | Highlights |
|---|---|
| **Login + shell** | identical-401 login, silent refresh (single-flight, bounded), logout, role-aware sidebar + route guards, unread badge |
| **Dashboard** | status/KPI cards, low-stock alerts, recent unread notifications, stale-while-revalidating refresh |
| **CRM** | customers CRUD/search/pagination, products CRUD (inactive badge, deactivate never deletes), warehouses (in-use delete → localized 409) |
| **Stock** | levels (string levels + low badge), immutable movements, adjust/transfer with zero-side-effect 409 UX |
| **Orders** | list/detail (D13 money), create with line editor + Idempotency-Key, **optimistic confirm** with rollback, cancel with reason gate |
| **Governance** | notifications (stored snapshots + mark-read), audit (JSON-text payload), users (invite/edit, no locale field), jobs (server-side filters + retry) |
| **RBAC** | 5 roles × 19 permissions mirrored from the backend registry (parity-tested); mid-session demotion re-renders on the next `/api/auth/me` |

NFRs enforced by the suite: no `any`, no `dangerouslySetInnerHTML`, no secrets in
the bundle, React Compiler on (no `useMemo`/`useCallback`), governance pages
lazy-chunked, requirement-ID coverage scan (R-UI-NFR-1..7).

## What's inside (backend vertical slices)

| Module | Highlights |
|---|---|
| **auth** | 5 roles × 19 permissions (const registry + SQL parity), identical 401, refresh rotation + reuse detection, per-request DB permission check, self-service locale |
| **crm** | customers CRUD/search/pagination, same-transaction audit |
| **orders** | status machine, idempotent create/confirm, **atomic confirm** (§3.1): order lock → product advisory locks → out-movements → audit → notifications → email jobs, commit-all or rollback-all |
| **stock** | immutable movement ledger (trigger-blocked), derived levels view, adjustments/transfers with negative-stock invariant, low-stock events (no cron), inactive products excluded |
| **jobs** | pg-boss `notification.send` queue (retryLimit 5, backoff, DLQ=failed), lifecycle audit, read API + manual retry |
| **notifications** | 7-type channel matrix, bilingual templates rendered per recipient locale (immutable snapshot), in-app API owner-scoped, templates without secrets |
| **audit** | append-only (trigger-blocked), same-tx writes, read API (admin/auditor), no credentials ever |
| **observability** | `/api/health` (public, Docker HEALTHCHECK), `/api/status` (authed, `queues` field), pino request logs with redact |

## Evidence

- **Dashboard**: [`docs/evidence/`](docs/evidence/) — 7 backend iterations + 6 capstone-ui iterations, green, links to per-iteration evidence (R-PROD-6/8, R-UI-NFR-7)
- Backend iterations: `docs/output-it1.txt` … `docs/output-it7.txt`
- UI iterations: `docs/output-ui-it1.txt` … `docs/output-ui-it6.txt` (suite counts + requirement IDs + demo commands)
- Spikes: [`docs/spike-pgboss-tx.md`](docs/spike-pgboss-tx.md) (same-tx enqueue), [`docs/spike-vitest-rtl.md`](docs/spike-vitest-rtl.md) (first vitest+RTL run)

## Deploy

- **CI/CD** → GitHub Container Registry (`ghcr.io/<owner>/business-operations-platform`) — see `.github/workflows/`
- **CI gate (R-PROD-3)**: backend typecheck + `node --test` **and** UI typecheck + vitest + vite build, all before the Docker build; the image itself re-runs the gate inside its build stage
- **Oracle Cloud Always Free ($0)**: full runbook with exact commands — [`docs/deploy-oracle.md`](docs/deploy-oracle.md)
- Secrets: env-only at runtime (never baked into the image); `.env.example` documents every variable with blank values

## Project layout

```
capstone/
├── backend/            # single backend package: src/{server,worker,app}.ts,
│                       #   config, db (migrations 001–007), lib, middleware,
│                       #   permissions, openapi, jobs, modules/{auth,crm,orders,
│                       #   stock,notifications,jobs,audit,observability}, tests
├── ui/                 # React 19 SPA: src/{api,auth,components,hooks,i18n,
│                       #   modules,pages,styles}, tests (vitest + RTL)
├── Dockerfile          # multi-stage (build = quality gate; runtime serves ui/dist), non-root, HEALTHCHECK
├── docker-compose.yml  # db → migrate → api + worker + mailpit (full appliance)
├── .github/workflows/  # ci.yml (push/PR) + cd.yml (v* tags → GHCR)
└── docs/               # evidence + runbook + dashboard
```

## Quality gates (R-NFR-3, R-UI-NFR-6)

- `npm run typecheck` — strict tsconfig both workspaces (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`)
- `npm test` — backend `node --test` + UI vitest; every requirement ID (backend R-AUTH-1 … R-PROD-8 + UI R-UI-*/R-RBAC-*/R-I18N-* …) appears in ≥1 test name
- Contract scans: parameterized SQL only, secrets from env only, no polling, mailer isolation, no hand-written OpenAPI, no `any`, no `dangerouslySetInnerHTML`, React Compiler on, i18n parity + neutral Spanish

---

*Repository: `business-operations-platform` · Capstone Temporada 1 · Built with strict TDD, evidence per iteration.*