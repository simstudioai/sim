-- migration-safe: Metadata-only storage option; existing and new workers retain the same index and query semantics.
ALTER INDEX "public"."user_table_rows_tenant_data_gin_idx" SET (fastupdate = off);--> statement-breakpoint
-- Release the DDL lock before maintenance and index builds. Everything below is safe to replay after a partial migration.
COMMIT;--> statement-breakpoint
-- Disabling fastupdate does not flush existing pending entries. Drain them once without rebuilding the index.
SET statement_timeout = '5min';--> statement-breakpoint
SELECT pg_catalog.gin_clean_pending_list('"public"."user_table_rows_tenant_data_gin_idx"'::regclass);--> statement-breakpoint
SET statement_timeout = 0;--> statement-breakpoint
-- Same key columns as workflow_execution_logs_workspace_activity_idx plus a trailing `level`, so it serves every scan the old index did and keeps the logs stats read index-only.
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; the index it supersedes is still in place until the drop below.
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_workspace_activity_level_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_workspace_activity_level_idx" ON "workflow_execution_logs" USING btree ("workspace_id","started_at","status","total_duration_ms","workflow_id","trigger","level");--> statement-breakpoint
-- migration-safe: superseded by workflow_execution_logs_workspace_activity_level_idx (a key-prefix superset, built above); no code references index names.
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_workspace_activity_idx";--> statement-breakpoint
SET lock_timeout = '5s';
