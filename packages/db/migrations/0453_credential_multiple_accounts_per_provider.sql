-- migration-safe: only removes the requirement that managed MCP identity columns stay NULL; every row the deployed app writes still satisfies the relaxed check.
ALTER TABLE "credential"
  DROP CONSTRAINT IF EXISTS "credential_managed_mcp_source_check",
  ADD CONSTRAINT "credential_managed_mcp_source_check" CHECK ((type::text <> 'managed_mcp') OR (
        id LIKE 'mcp-cg-%'
        AND account_id IS NULL
        AND provider_id IS NULL
        AND authorization_app_id IS NULL
        AND credential_group_enrollment_id IS NOT NULL
        AND credential_group_option_id IS NULL
        AND mcp_server_id IS NOT NULL
        AND managed_oauth_status IS NOT NULL
        AND (managed_oauth_status <> 'active' OR (
          encrypted_oauth_token_set IS NOT NULL
          AND mcp_tools IS NOT NULL
        ))
        AND granted_at IS NOT NULL
        AND managed_oauth_scope_version IS NULL
        AND granted_scopes IS NULL
        AND provider_metadata IS NULL
        AND created_by IS NULL
        AND env_key IS NULL
        AND env_owner_user_id IS NULL
        AND encrypted_service_account_key IS NULL
        AND unredacted = false
      )) NOT VALID;--> statement-breakpoint
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
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('credential_managed_mcp_identity_unique_failed')
      AND (indisvalid OR indrelid <> to_regclass('credential'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index credential_managed_mcp_identity_unique_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('credential_managed_mcp_enrollment_server_identity_unique')
      AND indrelid = to_regclass('credential') AND NOT indisvalid
  ) THEN
    ALTER INDEX "credential_managed_mcp_enrollment_server_identity_unique" RENAME TO "credential_managed_mcp_identity_unique_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
ALTER TABLE "credential" VALIDATE CONSTRAINT "credential_managed_mcp_source_check";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_option_identity_unique_failed";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "credential_managed_mcp_identity_unique_failed";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_option_identity_unique" ON "credential" USING btree ("credential_group_enrollment_id","credential_group_option_id","provider_subject_id",coalesce("provider_tenant_id", '')) WHERE "credential"."type" = 'managed_oauth';--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_managed_mcp_enrollment_server_identity_unique" ON "credential" USING btree ("credential_group_enrollment_id","mcp_server_id",coalesce("provider_subject_id", ''),coalesce("provider_tenant_id", '')) WHERE "credential"."type" = 'managed_mcp';--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_option_unique";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "credential_managed_mcp_enrollment_server_unique";--> statement-breakpoint
SET lock_timeout = '5s';
