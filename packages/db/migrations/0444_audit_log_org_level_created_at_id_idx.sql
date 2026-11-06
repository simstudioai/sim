-- The organization-level rows of an organization's audit log, newest first. A listing reads them
-- as one keyset branch (workspace_id IS NULL, metadata organizationId equal to the organization,
-- ordered by the millisecond-truncated created_at and id), and no index served that order: the
-- planner fetched every workspace-less row, which are spread across the whole heap, and filtered
-- them for the organization, so an organization with few such rows near the top paid for all of
-- them on every page.
--
-- The partial predicate is what that branch states: equality on the metadata key is strict, so it
-- implies the IS NOT NULL, and the branch spells workspace_id IS NULL literally. Rows attributed
-- only by resource (resource_type 'organization') stay on audit_log_resource_idx; there are few.
--
-- Replay-safety: audit_log takes writes continuously, so the build is CONCURRENTLY, below an
-- embedded COMMIT, and a failure there replays the whole file from the top. A failed concurrent
-- build leaves an INVALID index that IF NOT EXISTS would keep: the replay moves only that one aside
-- to be dropped, so a valid index built by an earlier attempt is kept rather than rebuilt.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('audit_log_org_level_created_at_id_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('audit_log'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index audit_log_org_level_created_at_id_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('audit_log_org_level_created_at_id_idx')
      AND indrelid = to_regclass('audit_log') AND NOT indisvalid
  ) THEN
    ALTER INDEX "audit_log_org_level_created_at_id_idx" RENAME TO "audit_log_org_level_created_at_id_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "audit_log_org_level_created_at_id_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_log_org_level_created_at_id_idx" ON "audit_log" USING btree (("metadata"->>'organizationId'),date_trunc('milliseconds', "created_at"),"id") WHERE "audit_log"."workspace_id" IS NULL AND ("audit_log"."metadata"->>'organizationId') IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';
