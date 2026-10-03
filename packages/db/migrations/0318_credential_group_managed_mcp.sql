-- Adds per-enrollment managed MCP grants without changing existing credential rows.
-- Pure expand: every new column is nullable, and no managed_mcp row can predate this migration.
-- Every pre-COMMIT statement is replay-safe because a concurrent index failure leaves this file
-- unjournaled while preserving the committed schema changes.
ALTER TYPE "public"."credential_type" ADD VALUE IF NOT EXISTS 'managed_mcp' BEFORE 'env_workspace';--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "mcp_server_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "mcp_tools" jsonb;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "mcp_tools_refreshed_at" timestamp;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "credential_group_id" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "managed_connector_id" text;--> statement-breakpoint

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, so replay guards are scoped to each table.
-- NOT VALID keeps foreign-key installation to a metadata change before validation.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'credential_mcp_server_id_mcp_servers_id_fk'
      AND "conrelid" = '"credential"'::regclass
  ) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "credential" VALIDATE CONSTRAINT "credential_mcp_server_id_mcp_servers_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'mcp_servers_credential_group_id_credential_group_id_fk'
      AND "conrelid" = '"mcp_servers"'::regclass
  ) THEN
    ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_credential_group_id_credential_group_id_fk" FOREIGN KEY ("credential_group_id") REFERENCES "public"."credential_group"("id") ON DELETE set null ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "mcp_servers" VALIDATE CONSTRAINT "mcp_servers_credential_group_id_credential_group_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'mcp_servers_credential_group_managed_connector_check'
      AND "conrelid" = '"mcp_servers"'::regclass
  ) THEN
    ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_credential_group_managed_connector_check" CHECK ("credential_group_id" IS NULL OR "managed_connector_id" IS NOT NULL) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "mcp_servers" VALIDATE CONSTRAINT "mcp_servers_credential_group_managed_connector_check";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'mcp_servers_managed_connector_oauth_check'
      AND "conrelid" = '"mcp_servers"'::regclass
  ) THEN
    ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_managed_connector_oauth_check" CHECK ("managed_connector_id" IS NULL OR "auth_type" = 'oauth') NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "mcp_servers" VALIDATE CONSTRAINT "mcp_servers_managed_connector_oauth_check";--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'credential_managed_mcp_source_check'
      AND "conrelid" = '"credential"'::regclass
  ) THEN
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
    )) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "credential" VALIDATE CONSTRAINT "credential_managed_mcp_source_check";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'credential_creator_source_check'
      AND "conrelid" = '"credential"'::regclass
  ) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_creator_source_check" CHECK ((type::text = 'managed_mcp') OR created_by IS NOT NULL) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "credential" VALIDATE CONSTRAINT "credential_creator_source_check";--> statement-breakpoint
ALTER TABLE "credential" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint

-- The commit makes the new enum label visible and moves index builds outside the migration
-- runner's transaction, as required by PostgreSQL for the partial and concurrent indexes.
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- A failed concurrent build leaves an invalid index behind, so each replay removes it first.
DROP INDEX CONCURRENTLY IF EXISTS "credential_mcp_server_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "credential_mcp_server_idx" ON "credential" USING btree ("mcp_server_id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "credential_managed_mcp_enrollment_server_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_managed_mcp_enrollment_server_unique" ON "credential" USING btree ("credential_group_enrollment_id","mcp_server_id") WHERE "credential"."type" = 'managed_mcp';--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "mcp_servers_credential_group_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "mcp_servers_credential_group_idx" ON "mcp_servers" USING btree ("credential_group_id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "mcp_servers_credential_group_managed_connector_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "mcp_servers_credential_group_managed_connector_unique" ON "mcp_servers" USING btree ("credential_group_id","managed_connector_id") WHERE "credential_group_id" IS NOT NULL AND "managed_connector_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
SET lock_timeout = '5s';
