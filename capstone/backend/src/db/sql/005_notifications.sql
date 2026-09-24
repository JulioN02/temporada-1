-- 005_notifications.sql — notification rows (T-4-1, S3: the atomic confirm
-- composition inserts in-app rows at it4; the full notifications module,
-- channel matrix registry and email enqueue land at it5). Idempotent.
-- R-NOT-2 (early): channel CHECK (in_app|email), type CHECK (7 locked types),
-- UNIQUE(type, reference, channel) = exactly-once (R-JOB-4/R-NOT-6 at it5).

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN (
    'order_confirmed', 'order_cancelled', 'low_stock',
    'stock_adjusted', 'stock_transferred', 'user_invited', 'job_failed'
  )),
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reference TEXT NOT NULL,              -- order:{id} | low_stock:{movementId} | adjust:{movementId} | ...
  read_at TIMESTAMPTZ,                  -- R-NOT-1 (it5 read/unread API)
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly-once PER RECIPIENT per event (REPORTED deviation from design §6's
  -- UNIQUE(type, reference, channel)): rows are per user (R-NOT-1 owner scope),
  -- so multi-recipient events (low_stock → manager+operator) need user_id in
  -- the dedupe key. Replaying a tx must not duplicate ANY recipient's row.
  UNIQUE (type, reference, channel, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_reference ON notifications(reference);