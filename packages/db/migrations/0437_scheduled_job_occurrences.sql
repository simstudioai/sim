-- Replay-safety: this file ends in CONCURRENTLY index builds below an embedded COMMIT,
-- so a failure there replays the whole file from the top — every statement here is idempotent.
ALTER TABLE "job_execution_logs" ADD COLUMN IF NOT EXISTS "occurrence_at" timestamp;--> statement-breakpoint
ALTER TABLE "job_execution_logs" ADD COLUMN IF NOT EXISTS "outcome" text;--> statement-breakpoint
ALTER TABLE "job_execution_logs" ADD COLUMN IF NOT EXISTS "summary" text;--> statement-breakpoint
ALTER TABLE "job_execution_logs" ADD COLUMN IF NOT EXISTS "billing_request_id" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN IF NOT EXISTS "run_budget_usd" numeric(12, 4);--> statement-breakpoint
-- A failed concurrent build leaves an invalid index that IF NOT EXISTS would keep: each replay
-- moves one aside to be dropped, never a valid index or one on another table.
DO $$
DECLARE
  index_name text;
BEGIN
  FOREACH index_name IN ARRAY ARRAY[
    'job_execution_logs_schedule_occurrence_unique',
    'job_execution_logs_billing_request_unique',
    'job_execution_logs_open_idx'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(index_name || '_failed')
        AND (indisvalid OR indrelid <> to_regclass('job_execution_logs'))
    ) THEN
      RAISE EXCEPTION 'Refusing to drop unexpected recovery index %_failed', index_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(index_name)
        AND indrelid = to_regclass('job_execution_logs') AND NOT indisvalid
    ) THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', index_name, index_name || '_failed');
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "job_execution_logs_schedule_occurrence_unique_failed";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "job_execution_logs_schedule_occurrence_unique" ON "job_execution_logs" USING btree ("schedule_id","occurrence_at");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "job_execution_logs_billing_request_unique_failed";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "job_execution_logs_billing_request_unique" ON "job_execution_logs" USING btree ("billing_request_id") WHERE "job_execution_logs"."billing_request_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "job_execution_logs_open_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "job_execution_logs_open_idx" ON "job_execution_logs" USING btree ("started_at") WHERE "job_execution_logs"."status" IN ('queued', 'running');--> statement-breakpoint
SET lock_timeout = '5s';
