# Specification: UI Stock & Orders (NEW — showpiece)

Change: `capstone-ui` · Project: `temporada-1` · Phase: **spec** · Artifact store: **hybrid** · Date: 2026-09-21
Upstream: proposal (capability `ui-stock-orders`) · Downstream: design.

## Purpose

Define the Stock (levels/movements/adjust/transfer) and Orders (list/detail/create/confirm/cancel) contracts — the atomic order↔stock showpiece. Idempotency-Key per mutation (R-UI-FND-4), D13 money as strings, 409 conflicts surfaced with ZERO side effects (backend guarantee, R-ORD-5/R-STK-3 — UI must reflect that the order stays `draft` / stock unchanged).

# 1. Stock (R-UI-STK)

### Requirement: R-UI-STK-1 — Stock levels table with low-stock badge

The Stock page MUST render the unpaginated `GET /api/stock` collection (rows per product×warehouse: sku, product name, warehouse, level) with optional `productId`/`warehouseId` filters. A row whose level is below the product's threshold MUST show a localized "stock bajo" badge. Levels are strings from the API; display MUST NOT coerce to floats.

- **Scenario: rows render** — GIVEN 2 products × 2 warehouses WHEN loaded THEN 4 rows render with string levels.
- **Scenario: low badge** — GIVEN level `"3"` and threshold 5 THEN the row shows the low-stock badge; level `"5"` (equal) also counts as low (`level <= threshold`).
- **Scenario: filters** — GIVEN `warehouseId` filter WHEN applied THEN only that warehouse's rows render.

### Requirement: R-UI-STK-2 — Movements history

The Movements tab MUST render `GET /api/stock/movements?productId=&type=&page=&limit=` newest-first (columns: date, type, product, warehouse, quantity, sign, reason) with pagination and filters (product, type: adjustment/transfer_out/transfer_in/order_out). Each adjustment/transfer submission MUST refresh this list.

- **Scenario: filter by type** — GIVEN mixed movements WHEN `type=adjustment` THEN only adjustment rows render.
- **Scenario: pagination** — GIVEN >limit movements THEN page controls render and page 2 loads the next batch.

### Requirement: R-UI-STK-3 — Adjust stock (signed quantity, reason, idempotent)

The adjust form MUST collect product, warehouse, a NON-ZERO signed integer quantity (up = positive, down = negative — mirrors the DTO), and reason ≥ 10 chars, then submit `POST /api/stock/movements` with an `Idempotency-Key`. Client validation MUST block qty = 0 and reason < 10 before submit. A 409 `NEGATIVE_STOCK` MUST render "Stock insuficiente para esa operación" / "Insufficient stock for that operation" and MUST NOT change the displayed level (zero side effects); the user MUST be able to retry with a NEW key (old key is consumed).

- **Scenario: adjust up** — GIVEN level `"10"` WHEN qty +5, reason "Ajuste de inventario inicial" THEN 201 and the level cell updates to `"15"`.
- **Scenario: below zero** — GIVEN level `"3"` WHEN qty −5 THEN the localized 409 renders and the level cell stays `"3"`.
- **Scenario: validation** — GIVEN qty 0 or reason "x" WHEN submit THEN localized client errors render, no request.
- **Scenario: replay 200** — GIVEN a submit retried with the SAME key (double-click) THEN the second response is 200 replay and exactly one movement appears in history.

### Requirement: R-UI-STK-4 — Transfer stock (from ≠ to, reason, idempotent)

The transfer form MUST collect product, fromWarehouse, toWarehouse, quantity (int ≥ 1), reason ≥ 10 and submit `POST /api/stock/transfers` with an `Idempotency-Key`. Client MUST block from = to (localized "Las bodegas deben ser diferentes" / "Warehouses must differ"). 409 `INSUFFICIENT_STOCK` MUST render the localized message and leave both level cells unchanged; 422 for reason/quantity renders per-field errors.

- **Scenario: transfer ok** — GIVEN A=`"10"`, B=`"0"` WHEN transfer 4 A→B THEN A shows `"6"`, B shows `"4"`, and 2 ledger rows appear in history.
- **Scenario: same warehouse** — GIVEN from = to WHEN submit THEN localized client error, no request.
- **Scenario: insufficient source** — GIVEN A=`"2"` WHEN transfer 5 THEN localized 409 and both cells unchanged.

# 2. Orders (R-UI-ORD)

### Requirement: R-UI-ORD-1 — Orders list with state filter and pagination

The Orders page MUST render `GET /api/orders?status=&customerId=&page=&limit=` (columns: id, customer, state with localized label/badge, total D13, createdAt, actions per state) with a state filter (all/draft/confirmed/cancelled) and pagination. Only draft orders show Confirm; draft or confirmed show Cancel (per R-RBAC-2).

- **Scenario: filter** — GIVEN 3 orders (2 confirmed) WHEN `status=confirmed` THEN 2 rows render.
- **Scenario: badge labels** — GIVEN locale 'es' THEN state badges render "Borrador / Confirmada / Cancelada".

### Requirement: R-UI-ORD-2 — Order detail with lines

Detail MUST render `GET /api/orders/:id` (order + lines: product name, qty, unitPrice, line total, order total as D13 strings, state, customer, createdAt) and format money per locale (R-UI-ORD-6). A 404 MUST render the localized not-found state with a link back to the list.

- **Scenario: detail** — GIVEN order id WHEN loaded THEN lines and total render from the API strings (exact, e.g. `"12.50"`).
- **Scenario: unknown id** — GIVEN id 9999 WHEN loaded THEN localized 404 state, no crash.

### Requirement: R-UI-ORD-3 — Create order with dynamic line editor

Create MUST open a form with customer select + dynamic line rows (product select, qty int ≥ 1, unitPrice D13 with scale ≤ 2, remove-row; add-line button; ≥ 1 line enforced client-side). Submit `POST /api/orders` with an `Idempotency-Key`. Client validation blocks empty customer, zero lines, qty < 1, unitPrice with scale > 2 or non-numeric, BEFORE submit. Server 422 (e.g. `UNKNOWN_PRODUCT`) and 409 render localized messages with the form intact. On 201 the new order appears in the list as `draft`.

- **Scenario: two lines** — GIVEN customer + 2 valid lines WHEN submit THEN 201, order shows as draft, list refreshes.
- **Scenario: scale > 2** — GIVEN unitPrice `"0.001"` WHEN submit THEN a localized client error on that line, no request.
- **Scenario: zero lines** — GIVEN an empty line list WHEN submit THEN localized "al menos una línea" error, no request.
- **Scenario: double submit** — GIVEN the same key replayed THEN exactly one order exists (replay 200).

### Requirement: R-UI-ORD-4 — Confirm order (optimistic, atomic 409 clean)

Confirm MUST run against a draft order: the UI updates the row optimistically (pending state) while `POST /api/orders/:id/confirm` (with `Idempotency-Key`) executes; on success the row becomes `confirmed` with a success toast. On 409 `INSUFFICIENT_STOCK` the optimistic change MUST roll back and the localized message MUST render ("Stock insuficiente para confirmar el pedido") with the order still `draft` and the stock module showing ZERO movements for this order (backend all-or-nothing). On 409 `INVALID_STATE` (already confirmed elsewhere) the row MUST refresh from the server. Confirm MUST be a two-step (button → confirm) action.

- **Scenario: happy path** — GIVEN a draft order with sufficient stock WHEN confirm THEN optimistic pending → confirmed, toast, stock levels drop by the line quantities.
- **Scenario: insufficient** — GIVEN line qty > available WHEN confirm THEN 409 localized, order stays draft, level cells unchanged, movements history shows no order_out rows.
- **Scenario: already confirmed** — GIVEN a confirmed order (different tab) WHEN confirm THEN 409 `INVALID_STATE` localized and the row refreshes to confirmed.
- **Scenario: confirm gate** — GIVEN the two-step action WHEN the user cancels the confirm step THEN no request fires.

### Requirement: R-UI-ORD-5 — Cancel order with reason

Cancel MUST collect a reason ≥ 10 chars (client-blocked otherwise) and submit `POST /api/orders/:id/cancel`. Success → `cancelled` state + localized toast; the stock module MUST remain unchanged (no reversal movements — R-ORD-6). 409 `INVALID_STATE` (already cancelled/confirmed-elsewhere) renders localized with a server refresh.

- **Scenario: cancel draft** — GIVEN a draft order WHEN cancel with reason "El cliente canceló la compra" THEN state becomes cancelled and stock levels do NOT change.
- **Scenario: short reason** — GIVEN reason "x" WHEN submit THEN localized client error, no request.

### Requirement: R-UI-ORD-6 — D13 money formatting per locale

All money display MUST format the API's D13 strings with `Intl.NumberFormat` using the ACTIVE locale (`es-ES` for 'es', `en-US` for 'en' — e.g. "12,50 €" vs "$12.50" per a shared currency formatter), while every payload sent to the API MUST remain a 2-decimal string ("12.50"). Money MUST NEVER be parsed to JS floats for display.

- **Scenario: es format** — GIVEN `"12.50"` and locale 'es' THEN the UI renders "12,50 €" (decimal comma).
- **Scenario: en format** — GIVEN the same string and locale 'en' THEN the UI renders "$12.50".
- **Scenario: round-trip** — GIVEN the form collects "12,50" in ES THEN the request body carries `"12.50"` (normalized, scale ≤ 2).