-- Replaces kcpii_subject_idx (import_id, subject_token) with the same unique key led by
-- subject_token.
--
-- Search resolves a reader's permission grants by subject_token alone (activeConnectorPermissionGrants),
-- and the old key led with import_id, so that lookup scanned the whole index. Led by subject_token,
-- it reads only the reader's identities, one per import that lists them. The uniqueness is the
-- same column set, so the identity insert's untargeted ON CONFLICT DO NOTHING and the per-import
-- conflict check (import_id plus subject_token) behave as before. The old index is dropped once
-- the new one is built, so the uniqueness never lapses and identity inserts maintain the same
-- number of indexes.
--
-- Replay-safety: as 0446. The build and the drop are CONCURRENTLY below an embedded COMMIT, and a
-- replay moves only an INVALID index left by a failed build aside to be dropped, keeping a valid one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('kcpii_subject_import_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('knowledge_connector_permission_import_identity'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index kcpii_subject_import_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('kcpii_subject_import_idx')
      AND indrelid = to_regclass('knowledge_connector_permission_import_identity') AND NOT indisvalid
  ) THEN
    ALTER INDEX "kcpii_subject_import_idx" RENAME TO "kcpii_subject_import_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "kcpii_subject_import_idx_failed";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "kcpii_subject_import_idx" ON "knowledge_connector_permission_import_identity" USING btree ("subject_token","import_id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "kcpii_subject_idx";--> statement-breakpoint
SET lock_timeout = '5s';
