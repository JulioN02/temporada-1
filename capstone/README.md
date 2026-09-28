# Business Operations Platform (BOP v1)

**The capstone of Temporada 1.** A platform that solves a real business problem —
the fragmentation of operations (inventory, orders, notifications, audit) scattered
across spreadsheets, email and disconnected tools — by integrating them into one
system where order confirmation is **atomic**, every mutation is **audited** and
**immutable**, and the whole thing is **verified with evidence**.

> "No demuestro que conozco una tecnología; demuestro que sé utilizarla para
> construir algo que tiene sentido." — El foco del dashboard es el problema y el
> método, no el stack.

**Publicación:** [Repo dedicado](https://github.com/JulioN02/business-operations-platform) ·
[Dashboard de publicación](https://julion02.github.io/business-operations-platform/) ·
[Evidencia](https://julion02.github.io/business-operations-platform/evidence/)

---

## Qué resuelve

Las operaciones diarias viven dispersas: planillas, correos, herramientas
inconexas. Eso produce errores caros — vender stock que no existe, perder avisos
críticos, pedidos sin estado claro, cero trazabilidad. BOP integra inventario,
pedidos, notificaciones y auditoría en un solo appliance:

- **Confirmación atómica de pedidos**: en una transacción — lock → movimientos →
  auditoría → notificaciones → emails — todo o nada, sin estados parciales.
- **Ledger de stock inmutable** con niveles derivados (nunca un contador) y eventos
  de bajo stock **sin polling**.
- **Auditoría append-only** (write-only) en la misma transacción de cada mutación.
- **Notificaciones bilingües (ES/EN neutro)** renderizadas al emitir, snapshot inmutable.
- **Jobs durables** (pg-boss) encolados en la misma transacción: exactly-once, sin outbox.

## How it works

An operator creates an order for a customer with several products. On confirm, BOP
checks that stock is sufficient and runs the whole operation atomically: it records the
outbound stock movements, writes the audit entry, creates the notifications and leaves
the email job pending for the worker. If any step fails, every change is rolled back —
no partial states, no half-sent notifications, no phantom stock.

## Qué demuestra

El portafolio está orientado a problemas, no a tecnologías. BOP demuestra un
núcleo transferible de resolución de problemas — *ANALIZAR → DISEÑAR →
DIAGNOSTICAR → IMPLEMENTAR → VERIFICAR → OPERAR → MEJORAR* — con evidencia en cada etapa:

| Etapa | Qué demuestra BOP |
|---|---|
| ANALIZAR | 122 requisitos en un contrato verificable con escenarios Given/When/Then; 72/72 IDs cubiertos por tests |
| DISEÑAR | Diseño de integridad transaccional: API-first, vertical slices, confirmación atómica, ledger inmutable |
| DIAGNOSTICAR | Bugs reales encontrados en verificación (scan de dist vacuo en CI, regex de cobertura, spec 11 vs 9 módulos) |
| IMPLEMENTAR | Strict TDD con tests referenciados por requisito, evidencia por iteración |
| VERIFICAR | 256/256 backend, 217/217 UI, tsc limpio, appliance Docker verificado en vivo |
| OPERAR | No es un repositorio, es un sistema operado: Docker appliance, CI/CD → GHCR, runbook Oracle, observabilidad |
| MEJORAR | S1–S3, F1, F3 y mejoras post-v1 documentadas con su motivo |

El nombre del cargo varía entre empresas (Software/Backend, Systems Analyst/IT
Analyst); la evidencia es la constante.

## El método

Marco de ingeniería **ISO-lite** completo (capstone): *problema → contexto → análisis
→ requisitos → alternativas → diseño → implementación → verificación → validación →
operación → lecciones aprendidas*. Cada decisión tecnológica se tomó ante una
alternativa, ligada a un problema — no a moda. **Strict TDD**: todo requisito tiene un
escenario y un test nombrado con su ID; el gate de cobertura impide código sin contrato.

## Stack (decisiones, no moda)

| Layer | Choice | Decisión (por qué) |
|---|---|---|
| Runtime | Node ≥ 22 (native TS, no build step) | Menos tooling; mismo lenguaje en API, worker y tests |
| API | Express 5 · zod v4 (fail-fast env + DTOs) | DTOs = fuente única de verdad → OpenAPI |
| Frontend | React 19 SPA · Vite 6 · RR7 · Compiler · TS strict | Contrato frontend verificable (217/217) |
| i18n | ES/EN const dictionaries + parity gates | Paridad en compilación; español neutro enforced |
| DB | PostgreSQL 16 (raw SQL + repository) | Control total de transacciones y advisory locks (database locks) |
| Money | D13 (exact decimal representation for money) exact string math (never JS float) | 0.1 + 0.2 ≠ 0.30000000000000004 |
| Jobs | pg-boss v12 | Misma transacción, cero infra extra; same-tx (job enqueued in the same transaction) enqueue |
| Email | nodemailer, worker-only | Fallo SMTP nunca toca la transacción de dominio |
| Docs | OpenAPI 3.1 from zod DTOs | Docs no pueden desincronizarse del código |
| Observabilidad | pino redact · health/status | Una línea parseable por request, sin secretos |
| Delivery | Multi-stage Docker (non-root, HEALTHCHECK) · compose · CI/CD → GHCR | Appliance autocontenido y offline |

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
| **RBAC** (role-based access control) | 5 roles × 19 permissions mirrored from the backend registry (parity-tested); mid-session demotion re-renders on the next `/api/auth/me` |

NFRs enforced by the suite: no `any`, no `dangerouslySetInnerHTML`, no secrets in
the bundle, React Compiler on (no `useMemo`/`useCallback`), governance pages
lazy-chunked, requirement-ID coverage scan (R-UI-NFR-1..7).

## Backend modules (vertical slices)

| Module | Highlights |
|---|---|
| **auth** | 5 roles × 19 permissions (const registry + SQL parity), identical 401, refresh rotation + reuse detection, per-request DB permission check, self-service locale |
| **crm** | customers CRUD/search/pagination, same-transaction audit |
| **orders** | status machine, idempotent create/confirm, **atomic confirm**: order lock → product advisory locks → out-movements → audit → notifications → email jobs, commit-all or rollback-all |
| **stock** | immutable movement ledger (trigger-blocked), derived levels view, adjustments/transfers with negative-stock invariant, low-stock events (no cron) |
| **jobs** | pg-boss `notification.send` queue (retryLimit 5, backoff, DLQ=failed), lifecycle audit, read API + manual retry |
| **notifications** | 7-type channel matrix, bilingual templates rendered per recipient locale (immutable snapshot), in-app API owner-scoped, templates without secrets |
| **audit** | append-only (trigger-blocked), same-tx writes, read API (admin/auditor), no credentials ever |
| **observability** | `/api/health` (public, Docker HEALTHCHECK), `/api/status` (authed), pino request logs with redact |

## Arquitectura

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

## Evidencia

- **Dashboard de publicación**: [`docs/dashboard/`](docs/dashboard/) — el proyecto
  completo leído como un caso de resolución de problemas: problema, método, análisis y
  requisitos, decisiones, diseño, implementación, verificación, operación, lecciones,
  mejoras y habilidades demostradas (autocontenido, offline-ready) · publicado en
  [GitHub Pages](https://julion02.github.io/business-operations-platform/)
- **Dashboard de evidencia**: [`docs/evidence/`](docs/evidence/) — 7 backend iterations
  + 6 capstone-ui iterations, green, links to per-iteration evidence (R-PROD-6/8, R-UI-NFR-7)
- Backend iterations: `docs/output-it1.txt` … `docs/output-it7.txt`
- UI iterations: `docs/output-ui-it1.txt` … `docs/output-ui-it6.txt` (suite counts + requirement IDs + demo commands)
- Spikes: [`docs/spike-pgboss-tx.md`](docs/spike-pgboss-tx.md) (same-tx enqueue), [`docs/spike-vitest-rtl.md`](docs/spike-vitest-rtl.md) (first vitest+RTL run)

## Documentation layers

`docs/dashboard/` — functional + engineering overview (GitHub Pages) · `docs/evidence/` —
verification by iteration · `docs/deploy-oracle.md` — operations/runbook ·
`docs/spike-*.md` — deep engineering spikes · `openspec/` — requirements & ADRs.

## Deploy

- **CI/CD** → GitHub Container Registry (`ghcr.io/<owner>/business-operations-platform`) — see `.github/workflows/`
- **CI gate (R-PROD-3)**: backend typecheck + `node --test` **and** UI typecheck + vitest + vite build, all before the Docker build; the image itself re-runs the gate inside its build stage
- **Oracle Cloud Always Free ($0)**: full runbook with exact commands — [`docs/deploy-oracle.md`](docs/deploy-oracle.md)
- **Secrets**: env-only at runtime (never baked into the image); `.env.example` documents every variable with blank values
- **Observability**: `/api/health` (public), `/api/status` (authed), pino JSON logs with redact

## Lecciones aprendidas

Las 11 completas están en el dashboard; las más transferibles:

1. El enqueue atómico en la misma transacción existe y funciona — eliminó outbox y poller.
2. El orden de los gates importa: el scan de secretos de `ui/dist` era vacuo porque vitest corría antes del build.
3. El regex de cobertura debe usar la misma convención que los IDs (multi-segmento), o el gate pasa en silencio.
4. La spec se equivoca a veces (11 vs 9 módulos); la verificación la corrige y lo documenta.
5. La paridad RBAC se logra importando el registry real del backend, no copiando la matriz a mano.

---

*Repository: [`JulioN02/business-operations-platform`](https://github.com/JulioN02/business-operations-platform) · Capstone Temporada 1 · Construido con el marco ISO-lite y strict TDD, evidencia por iteración.*