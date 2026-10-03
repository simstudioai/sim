COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_workspace_activity_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_workspace_activity_idx" ON "workflow_execution_logs" USING btree ("workspace_id","started_at","status","total_duration_ms","workflow_id","trigger");--> statement-breakpoint
SET lock_timeout = '5s';
