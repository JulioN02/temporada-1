-- 004_stock.sql — immutable movement ledger + derived stock view (T-4-1, it4)
-- The products/warehouses tables live in 002b_stock_catalog.sql (Batch B
-- deviation #1); this file is NEW and free for the ledger. Idempotent:
-- CREATE IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
-- R-STK-1: immutability trigger blocks UPDATE/DELETE (corrections are new
-- adjustment rows). R-STK-2: stock is DERIVED (view), never a stored counter.
-- R-STK-6: idempotency_key UNIQUE (adjust:{productId}:{uuid} /
-- transfer:{from}:{to}:{uuid} / order_out:{orderId}:{productId}).

CREATE TABLE IF NOT EXISTS movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  type TEXT NOT NULL CHECK (type IN ('adjustment', 'transfer_out', 'transfer_in', 'order_out')),
  quantity INT NOT NULL CHECK (quantity > 0),        -- always positive magnitude
  sign SMALLINT NOT NULL CHECK (sign IN (-1, 1)),    -- direction: level = SUM(quantity * sign)
  CHECK (                                             -- sign/type coherence (design §6)
    (type IN ('transfer_in') AND sign = 1) OR
    (type IN ('transfer_out', 'order_out') AND sign = -1) OR
    (type = 'adjustment')                             -- adjustment: sign ±1
  ),
  reason TEXT NOT NULL,                               -- 'order <id> confirmed' | user reason ≥10 (DTO)
  idempotency_key TEXT UNIQUE,                        -- NULL on secondary rows (PG UNIQUE treats NULLs as distinct)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movements_product_created ON movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_warehouse ON movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_movements_type ON movements(type);

-- Derived stock — SQL aggregation (R-STK-2): always current, never materialized.
CREATE OR REPLACE VIEW stock_levels AS
  SELECT product_id, warehouse_id, SUM(quantity * sign)::BIGINT AS level
  FROM movements
  GROUP BY product_id, warehouse_id;

-- Defense-in-depth immutability (R-STK-1): corrections are NEW adjustment
-- rows, never UPDATE/DELETE (same pattern as audit_log, 006_audit.sql).
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'movements are append-only: UPDATE/DELETE forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movements_append_only ON movements;
CREATE TRIGGER trg_movements_append_only
  BEFORE UPDATE OR DELETE ON movements FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();