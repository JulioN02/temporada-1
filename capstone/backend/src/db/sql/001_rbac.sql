-- 001_rbac.sql — RBAC + refresh tokens (T-1-1, per design §6 + ADR-7)
-- Idempotent: CREATE IF NOT EXISTS + INSERT ON CONFLICT DO NOTHING.
-- Schema per design §6: NO role_permissions table — the role→permission
-- matrix lives in the TS const registry (permissions/registry.ts) and is
-- parity-tested against these seeds (R-AUTH-7). The per-request DB check is a
-- role lookup via user_roles (R-AUTH-8).
-- NOTE: the permission matrix yields 19 codes (spec §5 matrix + ADR-7 list);
-- the "18 perms" figure in design/tasks is a miscount — parity test enforces
-- the actual set.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username CITEXT NOT NULL UNIQUE,
  full_name TEXT,
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- bcrypt cost 10, never plaintext (R-AUTH-6)
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,            -- admin | manager | operator | viewer | auditor
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE             -- '{module}:{operation}', mirrors const registry
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Refresh sessions: SHA-256 hashes ONLY (R-NFR-5); raw tokens never stored.
-- (Design §6 omits this table — required by R-AUTH-4/R-NFR-5; added here.)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,                  -- = JWT jti claim
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,              -- token family for reuse detection (R-AUTH-4)
  token_hash CHAR(64) NOT NULL,         -- SHA-256 hex of token; raw token NEVER stored
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,               -- NULL = active
  replaced_by TEXT,                     -- jti that rotated this one
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- Seed permissions — 19 codes from the locked matrix (spec §5, ADR-7)
INSERT INTO permissions (code) VALUES
  ('auth:user_create'), ('auth:user_read'), ('auth:user_update'),
  ('crm:customer_create'), ('crm:customer_read'), ('crm:customer_update'),
  ('orders:order_create'), ('orders:order_read'), ('orders:order_confirm'), ('orders:order_cancel'),
  ('stock:product_manage'), ('stock:stock_adjust'), ('stock:stock_transfer'), ('stock:stock_read'),
  ('jobs:job_read'), ('jobs:job_retry'),
  ('notification:read'), ('notification:update'),
  ('audit:read')
ON CONFLICT (code) DO NOTHING;

-- Seed roles — exactly five (R-AUTH-7)
INSERT INTO roles (code, description) VALUES
  ('admin', 'Full access to all modules'),
  ('manager', 'Operational management: crm, orders, stock, jobs, notifications'),
  ('operator', 'Day-to-day operations: crm, orders, stock adjustments, notifications'),
  ('viewer', 'Read-only access to crm, orders, stock and notifications'),
  ('auditor', 'Read access plus audit trail')
ON CONFLICT (code) DO NOTHING;