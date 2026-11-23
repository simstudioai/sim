-- A workspace's live file list, most recently modified first: the file browser's default sort.
-- 0442 indexed the upload order, but no index served this one, so each list read every live file
-- of the workspace and sorted them, which for a large workspace runs from disk and reaches the
-- statement timeout.
--
-- The predicate and the heap-only owner checks are 0442's, for the same reasons; the key is the
-- (updated_at, id) keyset the list orders and resumes on, kept as narrow.
--
-- Replay-safety: as 0442. The build is CONCURRENTLY below an embedded COMMIT, and a replay moves
-- only an INVALID index left by a failed build aside to be dropped, keeping a valid one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('workspace_files_workspace_active_updated_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('workspace_files'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index workspace_files_workspace_active_updated_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('workspace_files_workspace_active_updated_idx')
      AND indrelid = to_regclass('workspace_files') AND NOT indisvalid
  ) THEN
    ALTER INDEX "workspace_files_workspace_active_updated_idx" RENAME TO "workspace_files_workspace_active_updated_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_workspace_active_updated_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_workspace_active_updated_idx" ON "workspace_files" USING btree ("workspace_id","updated_at","id") WHERE "workspace_files"."deleted_at" IS NULL AND "workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
