-- Preserve a valid prior build; recover an interrupted concurrent build before replaying.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('credential_group_option_identity_unique_failed')
      AND (indisvalid OR indrelid <> to_regclass('credential'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index credential_group_option_identity_unique_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('credential_group_option_identity_unique')
      AND indrelid = to_regclass('credential') AND NOT indisvalid
  ) THEN
    ALTER INDEX "credential_group_option_identity_unique" RENAME TO "credential_group_option_identity_unique_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_option_identity_unique_failed";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_option_identity_unique" ON "credential" USING btree ("credential_group_enrollment_id","credential_group_option_id","provider_subject_id",coalesce("provider_tenant_id", '')) WHERE "credential"."type" = 'managed_oauth';--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_option_unique";--> statement-breakpoint
SET lock_timeout = '5s';
