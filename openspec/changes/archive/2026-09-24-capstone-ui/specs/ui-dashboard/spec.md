# Specification: UI Dashboard (NEW)

Change: `capstone-ui` · Project: `temporada-1` · Phase: **spec** · Artifact store: **hybrid** · Date: 2026-09-21
Upstream: proposal (capability `ui-dashboard`) · Downstream: design.

## Purpose

Define the Dashboard page contract: system status, KPI counts, low-stock and notification alerts — the "practical" landing page that replaces the rejected v1 flat dashboard. All roles see the Dashboard (read-only).

### Requirement: R-UI-DSH-1 — Status and KPI cards

The Dashboard MUST render: (a) a system card from `GET /api/status` (version, uptime, db up/down, timestamp) and `GET /api/health`; (b) KPI cards for total customers (`GET /api/customers?limit=1` → pagination.total), total products (`GET /api/products?limit=1`), and total orders (`GET /api/orders?limit=1`). Each card MUST show a localized label and a loading state while fetching; a failed card MUST show its own localized error with retry without blocking the others.

- **Scenario: admin KPIs** — GIVEN 25 customers, 8 products, 14 orders WHEN Dashboard loads THEN cards show 25 / 8 / 14 and the status card shows `ok` + version.
- **Scenario: partial failure** — GIVEN `GET /api/status` 503s (db down) WHEN the page loads THEN the status card renders the degraded state while the count cards still render.
- **Scenario: role parity** — GIVEN viewer or auditor WHEN Dashboard loads THEN the same cards render (all roles have the underlying read permissions).

### Requirement: R-UI-DSH-2 — Low-stock alert card

The Dashboard MUST surface products at or below their low-stock threshold, derived client-side from `GET /api/stock` (rows where `level <= lowStockThreshold` for the product — threshold compared via the product record from `GET /api/products` when available, else from the stock row set). The card MUST list product name, SKU, level, threshold and a localized message ("Stock bajo" / "Low stock"); an empty result MUST render the localized "no alerts" state.

- **Scenario: alerts present** — GIVEN a product with threshold 5 and level 3 WHEN Dashboard loads THEN the low-stock card lists it with level 3 / threshold 5.
- **Scenario: none low** — GIVEN all levels above thresholds WHEN Dashboard loads THEN the card renders "Sin alertas de stock" (no list rows).

### Requirement: R-UI-DSH-3 — Recent notifications summary

The Dashboard MUST render the 5 most recent unread notifications (`GET /api/notifications?unreadOnly=true&limit=5`) with title/type/createdAt (stored snapshot, per R-BE-3) and link to the Notifications page. The nav unread badge (R-UI-NOT-3) and this card MUST stay consistent after mark-read.

- **Scenario: summary** — GIVEN 3 unread notifications WHEN Dashboard loads THEN the card lists them; after marking one read on the Notifications page and returning, the card shows 2.

### Requirement: R-UI-DSH-4 — On-demand refresh

The Dashboard MUST provide a refresh control (button) that re-fetches all cards and updates without a full page reload; a refresh failure MUST NOT clear previously rendered data (stale-while-revalidating on error).

- **Scenario: refresh** — GIVEN loaded Dashboard WHEN the user clicks refresh THEN all cards re-fetch and update (mock asserts 2nd round of calls); on a failed re-fetch the previous values remain visible with the error toast.