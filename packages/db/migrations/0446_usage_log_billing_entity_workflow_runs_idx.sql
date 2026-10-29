-- Counts a billing entity's workflow runs in a period without reading the heap. A run is a
-- distinct execution_id among the entity's source = 'workflow' rows, and neither covering cost
-- index carries execution_id, so the admin dashboard's count fetched every matched row from the
-- heap. Widening those indexes instead would make every hot period sum read a wider index.
--
-- The key leads with the stamps as usage_log_billing_entity_period_cost_idx does, so a stamped
-- period is bounded by its four leading columns; user_id follows for the per-user counts. The
-- partial predicate is what each count states: source spelled literally, and billing_entity_type
-- equality implies the IS NOT NULL.
--
-- Replay-safety: usage_log is a hot append-only ledger, so the build is CONCURRENTLY, below an
-- embedded COMMIT, and a failure there replays the whole file from the top. A failed concurrent
-- build leaves an INVALID index that IF NOT EXISTS would keep: the replay moves only that one aside
-- to be dropped, so a valid index built by an earlier attempt is kept rather than rebuilt.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('usage_log_billing_entity_workflow_runs_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('usage_log'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index usage_log_billing_entity_workflow_runs_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('usage_log_billing_entity_workflow_runs_idx')
      AND indrelid = to_regclass('usage_log') AND NOT indisvalid
  ) THEN
    ALTER INDEX "usage_log_billing_entity_workflow_runs_idx" RENAME TO "usage_log_billing_entity_workflow_runs_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "usage_log_billing_entity_workflow_runs_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "usage_log_billing_entity_workflow_runs_idx" ON "usage_log" USING btree ("billing_entity_type","billing_entity_id","billing_period_start","billing_period_end","user_id","created_at","execution_id") WHERE "usage_log"."source" = 'workflow' AND "usage_log"."billing_entity_type" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
