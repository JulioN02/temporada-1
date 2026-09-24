-- 002_crm.sql — customers (T-2-1, design §6, R-CRM-1..5)
-- Idempotent: CREATE TABLE IF NOT EXISTS. CITEXT UNIQUE email: the dup-email
-- conflict (R-CRM-1) surfaces as PG 23505 → service maps to 409 DUPLICATE_EMAIL.
-- status CHECK (active|inactive) per R-CRM-4 (default list excludes inactive).

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email CITEXT UNIQUE,                    -- CITEXT: case-insensitive dup detection (R-CRM-1)
  phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')), -- R-CRM-4
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);