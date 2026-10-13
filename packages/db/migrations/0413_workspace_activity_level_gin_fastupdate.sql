-- migration-safe: Metadata-only storage option; existing and new workers retain the same index and query semantics.
ALTER INDEX "public"."user_table_rows_tenant_data_gin_idx" SET (fastupdate = off);--> statement-breakpoint
-- Release the DDL lock before maintenance and index builds. Everything below is safe to replay after a partial migration.
COMMIT;--> statement-breakpoint
-- Disabling fastupdate does not flush existing pending entries. Drain them once without rebuilding the index.
SET statement_timeout = '5min';--> statement-breakpoint
SELECT pg_catalog.gin_clean_pending_list('"public"."user_table_rows_tenant_data_gin_idx"'::regclass);--> statement-breakpoint
SET statement_timeout = 0;--> statement-breakpoint
-- Same key columns as workflow_execution_logs_workspace_activity_idx plus a trailing `level`, so it serves every scan the old index did and keeps the logs stats read index-only.
SET lock_timeout = '5s';--> statement-breakpoint
-- A replay keeps a valid build of the new index, since the drop below may already have removed the one it supersedes. Only an invalid build left by an interrupted run is set aside and rebuilt.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('"public"."workflow_execution_logs_workspace_activity_level_idx_failed"')
      AND (indisvalid OR indrelid <> '"public"."workflow_execution_logs"'::regclass)
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected index workflow_execution_logs_workspace_activity_level_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('"public"."workflow_execution_logs_workspace_activity_level_idx"')
      AND indrelid = '"public"."workflow_execution_logs"'::regclass
      AND NOT indisvalid
  ) THEN
    ALTER INDEX "public"."workflow_execution_logs_workspace_activity_level_idx" RENAME TO "workflow_execution_logs_workspace_activity_level_idx_failed";
  END IF;
END $$;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: drops only the invalid interrupted build set aside above; a valid replacement and the index it supersedes are never touched here.
DROP INDEX CONCURRENTLY IF EXISTS "public"."workflow_execution_logs_workspace_activity_level_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_workspace_activity_level_idx" ON "workflow_execution_logs" USING btree ("workspace_id","started_at","status","total_duration_ms","workflow_id","trigger","level");--> statement-breakpoint
-- migration-safe: superseded by workflow_execution_logs_workspace_activity_level_idx (a key-prefix superset, built above); no code references index names.
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_workspace_activity_idx";--> statement-breakpoint
SET lock_timeout = '5s';
