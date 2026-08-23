-- migration-safe: tune the append-only ledger's vacuum thresholds without changing row data or query semantics.
ALTER TABLE "usage_log" SET (autovacuum_vacuum_insert_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.01);--> statement-breakpoint
-- Concurrent index operations cannot run inside the migration runner's transaction.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "doc_active_kb_filename_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_active_kb_filename_idx" ON "document" USING btree ("knowledge_base_id","filename","uploaded_at" DESC,"token_count") WHERE "document"."user_excluded" = false AND "document"."archived_at" IS NULL AND "document"."deleted_at" IS NULL;--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "folder_active_workspace_resource_sort_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "folder_active_workspace_resource_sort_idx" ON "folder" USING btree ("workspace_id","resource_type","sort_order","created_at") WHERE "folder"."deleted_at" IS NULL;--> statement-breakpoint
-- migration-safe: the existing connector_id index remains available while this ordered replacement expands.
DROP INDEX CONCURRENTLY IF EXISTS "kcsl_connector_started_at_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kcsl_connector_started_at_idx" ON "knowledge_connector_sync_log" USING btree ("connector_id","started_at" DESC);--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "table_views_workspace_created_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_views_workspace_created_idx" ON "table_views" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "workflow_active_workspace_sort_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_active_workspace_sort_idx" ON "workflow" USING btree ("workspace_id","sort_order","created_at","id") WHERE "workflow"."archived_at" IS NULL;--> statement-breakpoint
-- migration-safe: replay removes an invalid build created by this migration; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "workflow_active_workspace_folder_sort_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_active_workspace_folder_sort_idx" ON "workflow" USING btree ("workspace_id","folder_id","sort_order","created_at","id") WHERE "workflow"."archived_at" IS NULL;--> statement-breakpoint
-- migration-safe: the existing workflow/time index remains available while the keyset replacement expands.
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_workflow_started_at_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_workflow_started_at_id_idx" ON "workflow_execution_logs" USING btree ("workflow_id","started_at","id");--> statement-breakpoint
-- migration-safe: each removed index duplicates a primary or unique index with the identical leading key.
DROP INDEX CONCURRENTLY IF EXISTS "academy_certificate_number_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "copilot_async_tool_calls_tool_call_id_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "mothership_settings_workspace_id_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "permissions_user_entity_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "session_token_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_file_key_idx";--> statement-breakpoint
SET lock_timeout = '5s';
