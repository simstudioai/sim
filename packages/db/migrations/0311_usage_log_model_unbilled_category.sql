-- Adds the `model_unbilled` usage_log category so BYOK model usage can be recorded at
-- zero cost for reporting. Purely additive: no existing row changes category, and every
-- billing aggregate over usage_log is SUM(cost), which zero-cost rows leave untouched.
--
-- Postgres cannot use a new enum value in the same transaction that adds it, so this
-- must be released BEFORE any code writes it.
ALTER TYPE "public"."usage_log_category" ADD VALUE IF NOT EXISTS 'model_unbilled';
