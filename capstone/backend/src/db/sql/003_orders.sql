-- 003_orders.sql — orders + order_items (T-3-1, design §6, R-ORD-1..7)
-- Idempotent: CREATE TABLE IF NOT EXISTS. order_items.product_id FKs to
-- products (004_stock, S2 — created in the same iteration).
-- Money: NUMERIC(13,2) everywhere (D13, R-ORD-2); pg returns strings.
-- state CHECK (draft|confirmed|cancelled) per R-ORD-3; snapshots keep line
-- integrity after product deactivation (R-STK-8).
-- NOTE (S5): confirm/cancel in it3 = status machine only; the atomic
-- composition (lock → sufficiency → movements → audit → events) replaces
-- confirm at it4 (T-4-6). confirm_idempotency_key is reserved for it4.

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'confirmed', 'cancelled')), -- R-ORD-3
  total NUMERIC(13,2) NOT NULL,           -- D13 exact string money (R-ORD-2)
  created_by BIGINT NOT NULL REFERENCES users(id),  -- order creator (recipient target, it5)
  idempotency_key TEXT UNIQUE,            -- R-ORD-4: create replay
  confirm_idempotency_key TEXT UNIQUE,    -- reserved for it4 atomic confirm (R-ORD-5)
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,                     -- ≥10 chars enforced in DTO (R-ORD-3)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(state);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),  -- FK dep → 004_stock (S2)
  product_name TEXT NOT NULL,             -- snapshot (R-STK-8: survives deactivation)
  product_sku TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),          -- qty int ≥1 (R-ORD-1)
  unit_price NUMERIC(13,2) NOT NULL,      -- D13 (R-ORD-2)
  line_total NUMERIC(13,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);