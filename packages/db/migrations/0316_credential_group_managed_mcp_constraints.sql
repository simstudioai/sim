-- Pure expand: every new column is nullable, and no managed_mcp row can predate 0315.
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "mcp_server_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "mcp_tools" jsonb;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "mcp_tools_refreshed_at" timestamp;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "credential_group_id" text;--> statement-breakpoint

-- NOT VALID avoids scanning existing tables while the foreign keys are installed. The new
-- nullable columns contain no values, so validation is immediate and safe.
ALTER TABLE "credential" ADD CONSTRAINT "credential_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "credential" VALIDATE CONSTRAINT "credential_mcp_server_id_mcp_servers_id_fk";--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_credential_group_id_credential_group_id_fk" FOREIGN KEY ("credential_group_id") REFERENCES "public"."credential_group"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "mcp_servers" VALIDATE CONSTRAINT "mcp_servers_credential_group_id_credential_group_id_fk";--> statement-breakpoint

ALTER TABLE "credential" ADD CONSTRAINT "credential_managed_mcp_source_check" CHECK ((type::text <> 'managed_mcp') OR (
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
        AND provider_subject_id IS NULL
        AND provider_tenant_id IS NULL
        AND granted_scopes IS NULL
        AND provider_metadata IS NULL
        AND created_by IS NULL
        AND env_key IS NULL
        AND env_owner_user_id IS NULL
        AND encrypted_service_account_key IS NULL
        AND unredacted = false
      )) NOT VALID;--> statement-breakpoint
ALTER TABLE "credential" VALIDATE CONSTRAINT "credential_managed_mcp_source_check";--> statement-breakpoint

-- Concurrent index operations cannot run inside the migration runner's transaction.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "credential_mcp_server_idx" ON "credential" USING btree ("mcp_server_id");--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_managed_mcp_enrollment_server_unique" ON "credential" USING btree ("credential_group_enrollment_id","mcp_server_id") WHERE "credential"."type" = 'managed_mcp';--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "mcp_servers_credential_group_idx" ON "mcp_servers" USING btree ("credential_group_id");--> statement-breakpoint
SET lock_timeout = '5s';
