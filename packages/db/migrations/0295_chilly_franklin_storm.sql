-- Schedule recovery scans async_jobs on every tick, and the stale-execution
-- cron sweeps workflow_execution_logs. Both tables take live writes, so the
-- supporting indexes are built without a table-wide write lock. The migration
-- runner starts a transaction per pending batch, so end it before CONCURRENTLY.
-- Everything below is replayable even when a failed concurrent build left an
-- INVALID same-named index behind.
COMMIT;--> statement-breakpoint

-- `lock_timeout = 0` for the concurrent builds, per packages/db/scripts/migrate.ts.
-- CREATE INDEX CONCURRENTLY waits on every concurrent write in the database, not
-- just this table, so the session's 5s DDL timeout would cancel it (55P03) and
-- strand an INVALID index that the IF NOT EXISTS below would skip forever.
SET lock_timeout = 0;--> statement-breakpoint

-- Carriers whose schedule accounting has not been replayed yet. The predicate
-- matches the recovery query's third branch verbatim -- both spell the status
-- list and the metadata key as literals, because Postgres cannot prove a
-- parameterised predicate implies a literal one and would seq-scan instead.
-- Rows leave the index the moment the reconciled marker is stamped, so it stays
-- small.
-- migration-safe: replay cleanup for the index introduced by this same unjournaled migration; CONCURRENTLY preserves async_jobs writes
DROP INDEX CONCURRENTLY IF EXISTS "async_jobs_schedule_unreconciled_terminal_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "async_jobs_schedule_unreconciled_terminal_idx" ON "async_jobs" USING btree ("updated_at","id") WHERE "async_jobs"."type" = 'schedule-execution' AND "async_jobs"."status" IN ('completed', 'failed', 'cancelled') AND COALESCE("async_jobs"."metadata" ->> 'scheduleReconciled', 'false') <> 'true';--> statement-breakpoint

-- Mirrors the existing `status = 'running'` pair so the stale-execution sweep
-- keeps an index for its second pass instead of falling back to a seq scan.
-- migration-safe: replay cleanup for the index introduced by this same unjournaled migration; CONCURRENTLY preserves workflow_execution_logs writes
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_redacting_started_at_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_redacting_started_at_idx" ON "workflow_execution_logs" USING btree ("started_at") WHERE status = 'redacting';--> statement-breakpoint

-- migration-safe: replay cleanup for the index introduced by this same unjournaled migration; CONCURRENTLY preserves workflow_execution_logs writes
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_redacting_deadline_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_redacting_deadline_idx" ON "workflow_execution_logs" USING btree ("execution_deadline_at") WHERE "workflow_execution_logs"."status" = 'redacting' AND "workflow_execution_logs"."execution_deadline_at" IS NOT NULL;--> statement-breakpoint

SET lock_timeout = '5s';
