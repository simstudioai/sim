-- A workspace's live file list, in upload order. No index served the list's filter in that
-- order, so the planner matched every workspace's live files, filtered to one workspace on the
-- heap and sorted them, on disk for a large workspace; a bounded read (the SSR seed, an
-- uploadedAt keyset page) paid for the whole workspace.
--
-- The predicate is the one the other live workspace-file indexes share, which the list's filter
-- implies. The list's owner conditions (project_id and organization_id IS NULL) stay heap checks
-- that discard nothing: the project and organization binding CHECKs rule both out for
-- workspace-context rows. The key stays narrow: carrying the listed name and storage key columns
-- would bring an entry near the btree size limit and fail the write.
--
-- Replay-safety: workspace_files takes uploads and edits continuously, so the build is
-- CONCURRENTLY, below an embedded COMMIT, and a failure there replays the whole file from the
-- top. A failed concurrent build leaves an INVALID index that IF NOT EXISTS would keep: the replay
-- moves only that one aside to be dropped, so a valid index built by an earlier attempt is kept.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('workspace_files_workspace_active_uploaded_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('workspace_files'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index workspace_files_workspace_active_uploaded_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('workspace_files_workspace_active_uploaded_idx')
      AND indrelid = to_regclass('workspace_files') AND NOT indisvalid
  ) THEN
    ALTER INDEX "workspace_files_workspace_active_uploaded_idx" RENAME TO "workspace_files_workspace_active_uploaded_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_files_workspace_active_uploaded_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_workspace_active_uploaded_idx" ON "workspace_files" USING btree ("workspace_id","uploaded_at","id") WHERE "workspace_files"."deleted_at" IS NULL AND "workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
