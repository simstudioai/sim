-- Indexes the runs that ended at least two hours after they started, by end.
--
-- The organization activity rollup computes each hour once it has settled, and finds the old runs
-- that change after that through this index: a HITL run resumed days later, a cancellation, a
-- stale-run sweep, or a run terminalized again. Every completion, failure and cancellation sets
-- ended_at, so each pass reads only the entries that ended since its last scan. A run ending
-- within two hours of its start lands in an hour that has not settled yet, which is why those are
-- left out, and why the predicate keeps the index to a small share of the table. The predicate is
-- immutable (timestamp plus interval), and the rollup's queries repeat it so the planner can use
-- the index.
--
-- Replay-safety: as 0446. workflow_execution_logs is hot, so the build is CONCURRENTLY below an
-- embedded COMMIT, and a replay moves only an INVALID index left by a failed build aside to be
-- dropped, keeping a valid one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('workflow_execution_logs_late_end_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('workflow_execution_logs'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index workflow_execution_logs_late_end_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('workflow_execution_logs_late_end_idx')
      AND indrelid = to_regclass('workflow_execution_logs') AND NOT indisvalid
  ) THEN
    ALTER INDEX "workflow_execution_logs_late_end_idx" RENAME TO "workflow_execution_logs_late_end_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_late_end_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_late_end_idx" ON "workflow_execution_logs" USING btree ("ended_at") WHERE "workflow_execution_logs"."ended_at" >= "workflow_execution_logs"."started_at" + interval '2 hours';--> statement-breakpoint
SET lock_timeout = '5s';
