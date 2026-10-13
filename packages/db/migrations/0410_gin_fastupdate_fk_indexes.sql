-- migration-safe: Metadata-only storage option; existing and new workers retain the same index and search semantics.
ALTER INDEX "public"."emb_content_fts_idx" SET (fastupdate = off);--> statement-breakpoint
-- Release the DDL lock before maintenance and index builds. Everything below is safe to replay after a partial migration.
COMMIT;--> statement-breakpoint
-- Disabling fastupdate does not flush existing pending entries. Drain them once without rebuilding the index.
SET statement_timeout = '5min';--> statement-breakpoint
SELECT pg_catalog.gin_clean_pending_list('"public"."emb_content_fts_idx"'::regclass);--> statement-breakpoint
SET statement_timeout = 0;--> statement-breakpoint
-- Indexes backing user and workspace delete actions, which otherwise scan these tables inside the deleting transaction.
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "doc_uploaded_by_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_uploaded_by_idx" ON "document" USING btree ("uploaded_by") WHERE "document"."uploaded_by" IS NOT NULL;--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "execution_large_values_workspace_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_large_values_workspace_id_idx" ON "execution_large_values" USING btree ("workspace_id");--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "user_table_def_created_by_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_table_def_created_by_idx" ON "user_table_definitions" USING btree ("created_by");--> statement-breakpoint
-- migration-safe: replay replaces only this new index to recover an interrupted concurrent build; existing indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "user_table_rows_created_by_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_table_rows_created_by_idx" ON "user_table_rows" USING btree ("created_by") WHERE "user_table_rows"."created_by" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
