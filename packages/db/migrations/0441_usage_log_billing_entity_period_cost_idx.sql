-- Replaces the two stamped-period indexes on usage_log with one covering index whose key leads
-- with both period stamps.
--
-- usage_log_billing_period_cost_idx carried `cost` but put user_id and created_at between
-- billing_period_start and billing_period_end, so a period sum (all four leading columns equal)
-- could only bound its scan on the first three. The planner also underestimates that match by
-- orders of magnitude, because the period stamps are functionally dependent on the entity and
-- their selectivities multiply. Together those made usage_log_billing_entity_period_idx (the same
-- four columns, no `cost`) look cheaper, and the hottest billing read took a heap fetch for every
-- matched row instead of reading the covering index.
--
-- The new key is a strict superset of usage_log_billing_entity_period_idx's, so it serves every
-- query that index served, and it carries every column usage_log_billing_period_cost_idx did, so
-- the weekly-refresh buckets (entity + billing_period_start) stay index-only. Both old indexes are
-- dropped once it is built: one index fewer to maintain on every ledger insert.
--
-- Replay-safety: usage_log is a hot append-only ledger, so the build and both drops are
-- CONCURRENTLY, below an embedded COMMIT, and a failure there replays the whole file from the top.
-- A failed concurrent build leaves an INVALID index that IF NOT EXISTS would keep: the replay moves
-- only that one aside to be dropped, so a valid index built by an earlier attempt is kept as is.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('usage_log_billing_entity_period_cost_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('usage_log'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index usage_log_billing_entity_period_cost_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('usage_log_billing_entity_period_cost_idx')
      AND indrelid = to_regclass('usage_log') AND NOT indisvalid
  ) THEN
    ALTER INDEX "usage_log_billing_entity_period_cost_idx" RENAME TO "usage_log_billing_entity_period_cost_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "usage_log_billing_entity_period_cost_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "usage_log_billing_entity_period_cost_idx" ON "usage_log" USING btree ("billing_entity_type","billing_entity_id","billing_period_start","billing_period_end","user_id","created_at","source","cost") WHERE "usage_log"."billing_entity_type" IS NOT NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "usage_log_billing_entity_period_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "usage_log_billing_period_cost_idx";--> statement-breakpoint
SET lock_timeout = '5s';
