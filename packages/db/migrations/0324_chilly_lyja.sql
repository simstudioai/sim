ALTER TYPE "public"."credential_type" ADD VALUE IF NOT EXISTS 'personal_token';--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "encrypted_personal_token" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "credential" ADD CONSTRAINT "credential_personal_token_source_check" CHECK ((type::text <> 'personal_token') OR (
        created_by IS NOT NULL
        AND provider_id IS NOT NULL
        AND provider_id = 'gitlab'
        AND provider_subject_id IS NOT NULL
        AND provider_tenant_id IS NOT NULL
        AND encrypted_personal_token IS NOT NULL
        AND granted_scopes IS NOT NULL
        AND cardinality(granted_scopes) > 0
        AND account_id IS NULL
        AND env_key IS NULL
        AND env_owner_user_id IS NULL
        AND credential_group_enrollment_id IS NULL
        AND authorization_app_id IS NULL
        AND encrypted_oauth_token_set IS NULL
        AND encrypted_service_account_key IS NULL
        AND unredacted = false
      )) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_personal_token_identity_unique" ON "credential" USING btree ("workspace_id","created_by","provider_id","provider_tenant_id","provider_subject_id") WHERE type = 'personal_token';
