-- 007_locale.sql — system-wide i18n: per-user + per-notification locale
-- (capstone-ui it1, T-1-1). Additive + idempotent (R-BE-1): ADD COLUMN IF NOT
-- EXISTS — safe re-run and safe downgrade; existing rows default 'es'; the
-- rendered notification history (title/body) is untouched — only the new
-- column is added. Locale values are whitelisted by the CHECK (es|en).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));