-- migration-safe: Metadata-only storage option; existing and new workers retain the same index and search semantics.
ALTER INDEX "public"."workspace_file_search_chunk_content_idx" SET (fastupdate = off);
--> statement-breakpoint
-- Release the DDL lock before maintenance. Both operations are safe to replay after a partial migration.
COMMIT;
--> statement-breakpoint
-- Disabling fastupdate does not flush existing pending entries. Drain them once without rebuilding the index.
SET statement_timeout = '5min';
--> statement-breakpoint
SELECT pg_catalog.gin_clean_pending_list('"public"."workspace_file_search_chunk_content_idx"'::regclass);
--> statement-breakpoint
SET statement_timeout = 0;
