COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new partial index to recover an interrupted concurrent build.
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_freebuff_recovery_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_freebuff_recovery_idx" ON "workflow_execution_logs" USING btree ("created_at","id") WHERE "execution_data" ? 'freebuffAttributionPending';--> statement-breakpoint
SET lock_timeout = '5s';
