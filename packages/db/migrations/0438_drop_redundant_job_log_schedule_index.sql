-- job_execution_logs_schedule_occurrence_unique (schedule_id, occurrence_at) leads with
-- schedule_id, so it serves every lookup and FK check the single-column index did.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "job_execution_logs_schedule_id_idx";--> statement-breakpoint
SET lock_timeout = '5s';
