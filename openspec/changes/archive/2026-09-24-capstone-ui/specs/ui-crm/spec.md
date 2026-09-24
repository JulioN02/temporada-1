# Specification: UI CRM — Customers, Products, Warehouses (NEW)

Change: `capstone-ui` · Project: `temporada-1` · Phase: **spec** · Artifact store: **hybrid** · Date: 2026-09-21
Upstream: proposal (capability `ui-crm`) · Downstream: design.

## Purpose

Define the CRM module contract: customers CRUD (search/filter/pagination, localized validation), products list/create, warehouses create — mirroring the verified backend surface. API error codes (409/422/403/404) map to localized friendly messages via `localizeError` (R-I18N-4).

### Requirement: R-UI-CRM-1 — Customers list with search, status filter, pagination

The Customers page MUST render a paginated table from `GET /api/customers?q=&status=&page=&limit=` with columns name, email, phone, status, createdAt; a search input (`q`, debounced), a status select (all/active/inactive), pagination controls (page/total/totalPages), and per-row Edit/Deactivate actions per role (R-RBAC-2). The list MUST NOT show inactive customers when no filter is set (backend default, R-CRM-4).

- **Scenario: search** — GIVEN customers "Ana Ruiz" and "Luis Paz" WHEN the user types `ana` THEN only Ana renders.
- **Scenario: pagination** — GIVEN 25 customers WHEN page 2 / limit 10 THEN rows 11–20 render with `total 25`, `totalPages 3`, and page 3 reachable.
- **Scenario: empty result** — GIVEN `q=zzz` with no matches THEN the localized empty state renders (R-UI-FND-3).
- **Scenario: 403** — GIVEN a viewer somehow reaches the page (guard bypass) WHEN the API returns 403 THEN the localized denial toast renders, not a crash.

### Requirement: R-UI-CRM-2 — Create customer form with localized validation

The create form (modal or page) MUST collect name (required), email (format), phone, notes and submit `POST /api/customers`. Client validation MUST block empty name and malformed email BEFORE submit; server 422 MUST render the localized field error; 409 `DUPLICATE_EMAIL` MUST render "Ese correo ya está en uso" / "That email is already in use". On 201 the list MUST refresh and a success toast renders.

- **Scenario: invalid email client-side** — GIVEN `email: "x"` WHEN submit THEN a localized email-format error renders and NO request fires.
- **Scenario: duplicate email** — GIVEN an existing email WHEN submit THEN the localized 409 message renders and the form stays open with data intact.
- **Scenario: success** — GIVEN valid input WHEN submit THEN 201, toast, list refresh with the new customer on top.

### Requirement: R-UI-CRM-3 — Edit customer

Edit MUST open a form pre-filled from the row, submit `PATCH /api/customers/:id` with changed fields, and render localized 404 ("Cliente no encontrado") and 409 (duplicate email) errors. Only `crm:customer_update` roles see the button (R-RBAC-2).

- **Scenario: update phone** — GIVEN customer WHEN the user edits phone only THEN PATCH sends `{phone}` and the row updates.
- **Scenario: unknown id** — GIVEN id removed concurrently WHEN PATCH THEN the localized 404 renders and the list refreshes.

### Requirement: R-UI-CRM-4 — Deactivate / reactivate customer

Deactivate MUST require an explicit confirm step (atomic confirm pattern — the action button turns into "Confirmar" before submitting), then `PATCH /api/customers/:id {status:"inactive"}`. The inactive customer MUST disappear from the unfiltered list; reactivation MUST be available from the "inactive" filter view. A confirmation cancel MUST NOT fire any request.

- **Scenario: confirm gate** — GIVEN a customer row WHEN the user clicks Deactivate THEN a confirm state renders; clicking the actual confirm button fires the PATCH; clicking away fires nothing.
- **Scenario: reactivate** — GIVEN the inactive filter THEN the row shows Activate; clicking it PATCHes `{status:"active"}` and the row returns to the default list.

### Requirement: R-UI-CRM-5 — Products list

The Products page MUST render a paginated table from `GET /api/products?q=&page=&limit=` (name, sku, lowStockThreshold, active) with search and per-row actions per role. Deactivated products MUST render with a visible "inactive" badge; stock levels for inactive products are excluded by the backend (R-STK-8) and MUST NOT appear in the Stock module.

- **Scenario: list + search** — GIVEN products WHEN `q` filters by name/sku THEN matching rows render; inactive rows show the badge.

### Requirement: R-UI-CRM-6 — Create product

Create MUST collect name (required), sku (required, `[A-Za-z0-9._-]`), lowStockThreshold (int ≥ 0, default 0) and submit `POST /api/products`. 409 `DUPLICATE_SKU` MUST render "Ese SKU ya existe" / "That SKU already exists"; 422 renders per-field localized messages. Only `stock:product_manage` roles (admin/manager) see the button.

- **Scenario: duplicate sku** — GIVEN an existing SKU WHEN submit THEN the localized 409 renders, form data intact.
- **Scenario: threshold validation** — GIVEN `lowStockThreshold: -1` WHEN submit THEN a localized error renders client-side (int ≥ 0), no request.

### Requirement: R-UI-CRM-7 — Product edit / deactivate (CONDITIONAL — API gap)

The UI MUST expose edit (name/threshold) and deactivate (never hard-delete, confirm-gated like R-UI-CRM-4) for `stock:product_manage` roles — **provided the backend endpoint exists**. Today the verified surface has NO `PATCH /api/products/:id` (checked: `stock/routes.ts` exposes only POST products/warehouses + GET products + stock endpoints). This requirement is therefore CONDITIONAL: either (a) design approves an additive delta `PATCH /api/products/:id {name?, sku?, lowStockThreshold?, active?}` (mirrors R-CRM-3, permission `stock:product_manage`, 409 `DUPLICATE_SKU`) — then this requirement is IN scope with the scenarios below; or (b) the change descopes product edit/deactivate to create+list, and this requirement is dropped at design with an explicit note. UI work MUST NOT invent endpoints.

- **Scenario (if delta approved): deactivate** — GIVEN the confirm gate WHEN the user confirms THEN `PATCH {active:false}` fires and the row shows the inactive badge and disappears from Stock levels.
- **Scenario (if delta approved): 409** — GIVEN a duplicate SKU on edit THEN the localized 409 renders.

### Requirement: R-UI-CRM-8 — Warehouses: create + derived list (folded into Stock module)

Warehouse management MUST live inside the Stock module (locked decision: manager+). The UI MUST offer a warehouse create form (`POST /api/warehouses {name}`, 422 localized) and MUST render a warehouse list **derived from `GET /api/stock`** (distinct `warehouse_name`/`warehouse_id` from the unpaginated stock rows — the only read surface; no `GET /api/warehouses` exists today). Warehouse rename/delete are NOT specifiable against the current API: flag for design (additive `PATCH /api/warehouses/:id` / `DELETE` or explicit descope). The warehouse picker in adjust/transfer forms MUST use this derived list.

- **Scenario: create warehouse** — GIVEN manager WHEN create with a valid name THEN 201 and the warehouse appears in the derived list after refresh.
- **Scenario: duplicate/422** — GIVEN an empty name WHEN submit THEN localized 422 renders, no request with empty name.
- **Scenario: picker** — GIVEN 2 warehouses WHEN the transfer form opens THEN both appear in the from/to selects (operator sees them for adjust too).