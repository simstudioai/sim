ALTER TYPE "public"."credential_type" ADD VALUE IF NOT EXISTS 'managed_api_key' BEFORE 'env_workspace';--> statement-breakpoint
COMMIT;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "encrypted_api_key" text;--> statement-breakpoint
ALTER TABLE "credential_group" ADD COLUMN IF NOT EXISTS "api_key_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- migration-safe: atomically widen the organization type check to admit managed_api_key while preserving every old allowed type; replay replaces the new API-key check identically.
DO $$ BEGIN
  ALTER TABLE "credential" DROP CONSTRAINT IF EXISTS "credential_organization_type_check";
  ALTER TABLE "credential" ADD CONSTRAINT "credential_organization_type_check" CHECK ("credential"."organization_id" IS NULL OR "credential"."type" IN ('oauth', 'managed_oauth', 'managed_mcp', 'managed_api_key', 'service_account', 'personal_token')) NOT VALID;
  ALTER TABLE "credential" DROP CONSTRAINT IF EXISTS "credential_managed_api_key_source_check";
  ALTER TABLE "credential" ADD CONSTRAINT "credential_managed_api_key_source_check" CHECK ((type::text <> 'managed_api_key') OR (
        credential_group_enrollment_id IS NOT NULL
        AND credential_group_option_id IS NOT NULL
        AND encrypted_api_key IS NOT NULL
        AND created_by IS NOT NULL
        AND granted_at IS NOT NULL
        AND managed_oauth_status IS NOT NULL
        AND account_id IS NULL
        AND provider_id IS NULL
        AND env_key IS NULL
        AND env_owner_user_id IS NULL
        AND encrypted_oauth_token_set IS NULL
        AND encrypted_personal_token IS NULL
        AND encrypted_service_account_key IS NULL
        AND unredacted = false
      )) NOT VALID;

END $$;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay replaces only this new index after an interrupted concurrent build; existing credential indexes remain available.
DROP INDEX CONCURRENTLY IF EXISTS "credential_managed_api_key_option_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_managed_api_key_option_unique" ON "credential" USING btree ("credential_group_enrollment_id","credential_group_option_id") WHERE "credential"."type" = 'managed_api_key';--> statement-breakpoint
SET lock_timeout = '5s';
