# Archive Report: CAPSTONE-UI — React 19 SPA + system-wide ES/EN i18n + backend delta

Change: `capstone-ui` · Project: `temporada-1` · Phase: **archive** · Artifact store: **hybrid**
Date: 2026-09-24 · Verdict upstream: `verify-report.md` — **PASS WITH WARNINGS** (archive-ready)
Repo: `business-operations-platform` · SDD cycle: **COMPLETE** (propose → spec → design → tasks → apply → verify → archive)

---

## 1. Executive Summary

The `capstone-ui` change — the React 19 SPA that replaces the rejected v1 vanilla verification UI, with system-wide ES/EN i18n (neutral professional Spanish) and an approved additive backend delta — completed its full SDD cycle and is now **archived**. Planned (proposal → 6 delta specs → design 8 ADRs → tasks 48), implemented (apply 48/48 tasks, 6 iterations, STRICT TDD, first vitest+RTL runner in the repo), verified (**PASS WITH WARNINGS**: 217/217 vitest + 256/256 backend real runs, `tsc --noEmit` clean both workspaces, vite build 132.53 kB gzip initial chunk, 72/72 requirement-ID coverage, 33/33 deviations accepted, Docker appliance live-serves the React SPA with `/api` JSON 404 preserved), and now archived with the delta specs merged into the main spec as the authoritative **v2 contract** (`openspec/specs/capstone/spec.md`). The three WARNING-level items (F1 dist-scan gate ordering, F2 spec wording, F3 stale Dockerfile comment) are non-blocking and cheap to fix — none required code changes for correctness.

## 2. Spec Sync (delta → main)

| Domain | Action | Details |
|--------|--------|---------|
| ui-foundation | **Merged → §11** | 19 requirements ADDED (R-AUTHUI-1..4, R-UI-FND-1..4, R-RBAC-1..4, R-UI-NFR-1..7). Wording fix applied (verify F2 / deviation #13): sidebar nav = **9 modules** per the R-RBAC-3 matrix (warehouses folded into Stock; Stock tabs are page-level). |
| ui-dashboard | **Merged → §12** | 4 requirements ADDED (R-UI-DSH-1..4). |
| ui-crm | **Merged → §13** | 8 requirements ADDED (R-UI-CRM-1..8). Conditionals RESOLVED to approved deltas: R-UI-CRM-7 (product edit/deactivate via `PATCH /api/products/:id`), R-UI-CRM-8 (warehouses CRUD via `GET/POST/PATCH/DELETE /api/warehouses`, `WAREHOUSE_IN_USE`). |
| ui-stock-orders | **Merged → §14** | 10 requirements ADDED (R-UI-STK-1..4, R-UI-ORD-1..6). Wording fix applied (deviation #14): transfer 409 code is `NEGATIVE_STOCK` (backend-verified; `INSUFFICIENT_STOCK` also mapped by R-I18N-4). R-UI-ORD-1 notes the customer column renders `#<customerId>` (deviation #15, no customerName in DTO). |
| ui-governance | **Merged → §15** | 9 requirements ADDED (R-UI-NOT-1..3, R-UI-AUD-1, R-UI-USR-1..3, R-UI-JOB-1..2). R-UI-JOB-1 RESOLVED to the approved server-side `state`/`queue` filters (pg-boss v12 6-state enum). |
| notification-i18n | **Merged → §16 + in-place** | 9 requirements ADDED (R-BE-1..5, R-I18N-1..4) + **3 MODIFIED in place**: R-NOT-5 (bilingual per-recipient-locale templates, immutable snapshot), R-PROD-3 (CI frontend gate), R-PROD-7 (React SPA replaces vanilla UI). Scope §"out of scope" bullet updated (React frontend + frontend tests no longer excluded). |

**Merge totals**: 63 v1 requirements preserved (3 updated in place, 0 removed) + 59 new requirements ADDED across sections 11–16 → merged spec = 1103 lines (was 609). API contract extended: `PATCH /api/auth/me`, `PATCH /api/products/:id`, `GET/PATCH/DELETE /api/warehouses`, `WAREHOUSE_IN_USE` subcode. No destructive merge — all v1 requirements not mentioned in the deltas preserved verbatim.

## 3. Change Closure

- `state.yaml` created with `status: archived` (archived_at 2026-09-24) — records phase completion and post-archive actions.
- Change folder moved to `openspec/changes/archive/2026-09-24-capstone-ui/` (ISO date prefix per convention).
- Active changes directory (`openspec/changes/`) no longer contains this change.
- Merged full spec copied to the archive as `spec.md` (flat layout, mirroring the 2026-09-21-capstone archive); the original 6 delta files are preserved under `specs/` as the audit trail.

## 4. Archive Contents (audit trail — never modify)

| Artifact | File | Engram observation |
|----------|------|--------------------|
| Proposal | proposal.md | #1419 (`sdd/capstone-ui/proposal`) |
| Spec (delta, 6 domains) | specs/{ui-foundation,ui-dashboard,ui-crm,ui-stock-orders,ui-governance,notification-i18n}/spec.md | #1420 (`sdd/capstone-ui/spec`) |
| Spec (merged v2 full) | spec.md | — (synced from `openspec/specs/capstone/spec.md`) |
| Design (8 ADRs) | design.md | #1423 (`sdd/capstone-ui/design`) |
| Tasks (48/48 [x]) | tasks.md | #1424 (`sdd/capstone-ui/tasks`) |
| Apply progress (batches A–E) | apply-progress.md | #1432 (`sdd/capstone-ui/apply-progress`) + batch discoveries #1434 (it1), #1435 (Batch A), #1441 (B1), #1446 (B2), #1447 (Batch C), #1451 (Batch D), #1453 (Batch E), #1433 (stock inactive exclusion flag a) |
| Verify report | verify-report.md | #1455 (`sdd/capstone-ui/verify-report`) + #1457 (verify discovery) |
| State | state.yaml | — |
| Archive report | archive-report.md | #1459 (`sdd/capstone-ui/archive-report`) + merge-decisions discovery #1460 |

## 5. Verify Status (binding)

- **Verdict: PASS WITH WARNINGS** — 48/48 tasks, 217/217 vitest (18 files, serial) + 256/256 backend (58 suites, real runs by the verifier), `tsc --noEmit` clean both workspaces, vite build ok (initial chunk 132.53 kB gzip, R-UI-NFR-5 < 250 kB), 72/72 requirement IDs independently reproduced (dynamic scan ≡ pinned static list), 33/33 deviations ACCEPTED (0 rejected).
- Real execution (by verify): backend `npm test -w backend` 256/256 (592 s); UI `npm test -w ui` 217/217 (385.7 s); `npm run typecheck` exit 0; `npm run build -w ui` exit 0; **live Docker re-confirm**: `/` → React SPA shell (`index-B4-2G7_F.js`), `/api/docs` → 200, `/orders/42` deep link → 200 SPA fallback, `/assets/*` static wins, `/api/does-not-exist` → JSON 404 preserved, `/api/health` ok.
- Security scan clean (code-auditor lens): tokens memory-only (storage-scan test), no secrets in bundle (source scan), no `dangerouslySetInnerHTML` with API data, no `any`, RBAC parity via direct backend-registry import, neutral-Spanish banned-token gate (236/236 keys both locales).
- CRITICAL: none. WARNING F1 (dist secret scan vacuous in CI/Docker ordering — gate-completeness, not code flaw), F2 (spec wording — fixed at this archive), F3 (stale Dockerfile comment, doc-only). SUGGESTIONS S1..S3 (UX polish).

## 6. Post-Archive Actions (NOT part of archive — orchestrator/user)

1. **F1**: reorder CI/Docker gates to build `ui/dist` BEFORE the vitest run (or split the R-UI-NFR-3 dist scan into a post-build step) so the dist-secret scan is non-vacuous in CI/Docker. One-line config change; `ui/tests/nfr.test.ts` L79-93 + in-file comment are inaccurate.
2. **F3**: fix the stale Dockerfile build-stage comment (L23-24) — `openspec/` is NOT in the `capstone/` build context; the `.dockerignore` comment is correct.
3. **S1** additive `customerName` on `OrderListItemDto` (orders list shows `#<customerId>`); **S2** optional role-name i18n keys for the user chip; **S3** optional failure toast for the LocaleToggle PATCH (self-heals via backend-wins-on-boot).
4. Season-1 portfolio: evidence dashboard already lists all 6 UI iterations (`docs/evidence/index.html`); portfolio integration per prior strategic decisions.

## 7. Risks / Notes

- **F1 is the only substantive follow-up**: the R-UI-NFR-3 dist-secret scan only really asserts locally (stale dist) or post-build; the source-level secret scan DOES run everywhere. Not archive-blocking (verify judged archive-ready), but should be closed early in the next change touching CI.
- No destructive merge performed — all merges were additive or in-place replacements of requirements explicitly MODIFIED by the delta; archived folder is an immutable audit trail.
- Repo name `business-operations-platform` carried over from v1 (R-PROD-8) — repo creation/GHCR verification remains a post-archive action from the v1 archive (T-7-8), not performed here.
- The v1 "Open items for design phase" section remains in the merged spec as historical record; all v1 items were resolved in v1 design, and capstone-ui conditionals were resolved at this merge.