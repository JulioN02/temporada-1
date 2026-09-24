-- 002b_stock_catalog.sql — products + warehouses (it3, S2: order_items FK needs
-- products BEFORE 003_orders; the migrate runner applies files in sorted order,
-- so these tables CANNOT live in 004_stock.sql — see apply-progress Batch B
-- deviation #1). The movements ledger, stock_levels view and immutability
-- trigger land at it4 in a NEW file 004_stock.sql (T-4-1) — because the runner
-- tracks files by name in `_migrations`, extending an applied file would not
-- re-run on persistent DBs.

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,               -- dup sku → 23505 → 409 DUPLICATE_SKU (R-STK-8)
  low_stock_threshold INT NOT NULL DEFAULT 0,   -- R-STK-7 (it4 choke point)
  active BOOLEAN NOT NULL DEFAULT true,   -- deactivated, never hard-deleted (R-STK-8)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);