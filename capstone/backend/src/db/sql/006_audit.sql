-- 006_audit.sql — append-only audit trail (F-7, S1 early port; read API lands it6)
-- Idempotent: CREATE IF NOT EXISTS / DROP TRIGGER IF EXISTS.

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,                 -- 'auth.login', 'user.create', 'order.confirm', ...
  entity TEXT,                          -- 'user' | 'order' | 'customer' | ...
  entity_id TEXT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_username TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,   -- NEVER passwords/tokens/hashes (R-AUD-3)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, action);

-- Append-only enforcement (R-AUD-1): only INSERT allowed.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: UPDATE/DELETE not allowed on %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_log;
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();