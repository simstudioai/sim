-- Replaces usage_log_workspace_created_at_idx with a covering index under the same two leading
-- columns.
--
-- Every Workspaces drill-down read filters on the billing entity, the workspace and a created_at
-- window, and reads cost with user_id, source or workflow_id. The old index held only
-- (workspace_id, created_at), so a drill-down matched the window there or on
-- usage_log_billing_entity_created_at_cost_idx and fetched every matched row from the heap to
-- check the rest: the workspace's rows on one, the whole organization's on the other. Dropping
-- usage_log_billing_entity_period_idx in 0441 took away the bitmap that used to narrow the second.
-- With the entity and every column those reads return in the key, each one is an index-only scan
-- bounded by the workspace's rows in the window.
--
-- The new key extends the old one, so it serves every read the old index served in the same
-- order: the workspace_id foreign key's ON DELETE SET NULL, and the ledger list filtered to a
-- workspace. The old index is dropped once the new one is built, so ledger inserts maintain the
-- same number of indexes.
--
-- Replay-safety: usage_log is a hot append-only ledger, so the build and the drop are
-- CONCURRENTLY, below an embedded COMMIT, and a failure there replays the whole file from the top.
-- A failed concurrent build leaves an INVALID index that IF NOT EXISTS would keep: the replay moves
-- only that one aside to be dropped, so a valid index built by an earlier attempt is kept as is.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('usage_log_workspace_created_at_cost_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('usage_log'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index usage_log_workspace_created_at_cost_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('usage_log_workspace_created_at_cost_idx')
      AND indrelid = to_regclass('usage_log') AND NOT indisvalid
  ) THEN
    ALTER INDEX "usage_log_workspace_created_at_cost_idx" RENAME TO "usage_log_workspace_created_at_cost_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "usage_log_workspace_created_at_cost_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "usage_log_workspace_created_at_cost_idx" ON "usage_log" USING btree ("workspace_id","created_at","billing_entity_type","billing_entity_id","user_id","source","cost","workflow_id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "usage_log_workspace_created_at_idx";--> statement-breakpoint
SET lock_timeout = '5s';
