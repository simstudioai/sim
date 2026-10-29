-- Two partial indexes over live workspace files, on the predicate the other live workspace-file
-- indexes share, for the paged files browser:
--
-- workspace_files_workspace_folder_uploaded_idx serves a folder page sorted by upload date
-- (equality on workspace and coalesce(folder_id, ''), then the raw (uploaded_at, id) keyset) and
-- seeks a folder's live files for its rollup. size_bytes stays out of the key to keep the index
-- narrow; the infrequent rollup reads it from the heap.
--
-- workspace_files_workspace_name_trgm_idx serves the case-insensitive substring name search
-- (original_name ILIKE '%term%') within one workspace, with fastupdate off so file writes never
-- stall on a foreground merge of pending entries. pg_trgm and btree_gin are created by 0313.
--
-- Replay-safety: workspace_files takes uploads and edits continuously, so both builds are
-- CONCURRENTLY, below an embedded COMMIT. Neither index has a deployed reader yet, so a replay
-- drops whatever an unjournaled earlier attempt left (valid or INVALID) and builds it again.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: new additive index with no deployed readers; drop any unjournaled prior build before rebuilding concurrently on replay.
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_workspace_folder_uploaded_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_workspace_folder_uploaded_idx" ON "workspace_files" USING btree ("workspace_id",coalesce("folder_id", ''),"uploaded_at","id") WHERE "workspace_files"."deleted_at" IS NULL AND "workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL;--> statement-breakpoint
-- migration-safe: new additive index with no deployed readers; drop any unjournaled prior build before rebuilding concurrently on replay.
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_workspace_name_trgm_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_workspace_name_trgm_idx" ON "workspace_files" USING gin ("workspace_id" text_ops,"original_name" gin_trgm_ops) WITH (fastupdate=off) WHERE "workspace_files"."deleted_at" IS NULL AND "workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
