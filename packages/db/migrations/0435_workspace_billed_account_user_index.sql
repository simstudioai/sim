-- Payer lookups for a user's workspaces; the user FK's delete check scans through it too.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('workspace_billed_account_user_id_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('workspace'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index workspace_billed_account_user_id_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('workspace_billed_account_user_id_idx')
      AND indrelid = to_regclass('workspace') AND NOT indisvalid
  ) THEN
    ALTER INDEX "workspace_billed_account_user_id_idx" RENAME TO "workspace_billed_account_user_id_idx_failed";
  END IF;
END $$;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_billed_account_user_id_idx_failed";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_billed_account_user_id_idx" ON "workspace" USING btree ("billed_account_user_id");
--> statement-breakpoint
SET lock_timeout = '5s';
