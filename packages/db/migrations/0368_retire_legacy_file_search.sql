SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
-- migration-safe: contract of #7947; deployed app, workers, and revision triggers use chunk storage. Retire only after the rollback window and completed backfill verification.
DROP TABLE IF EXISTS "workspace_file_search_segment";
--> statement-breakpoint
-- migration-safe: contract of #7947; current revision metadata lives in workspace_file_search_revision, with no remaining runtime reader of this legacy table.
DROP TABLE IF EXISTS "workspace_file_search_index";
