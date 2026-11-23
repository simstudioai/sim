-- Preserve a valid prior build; recover an interrupted concurrent build before replaying.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('people_directory_scim_change_due_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('people_directory_scim_change'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index people_directory_scim_change_due_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('people_directory_scim_change_due_idx')
      AND indrelid = to_regclass('people_directory_scim_change') AND NOT indisvalid
  ) THEN
    ALTER INDEX "people_directory_scim_change_due_idx" RENAME TO "people_directory_scim_change_due_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "people_directory_scim_change_due_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "people_directory_scim_change_due_idx" ON "people_directory_scim_change" USING btree ("changed_at","organization_id");--> statement-breakpoint
SET lock_timeout = '5s';
