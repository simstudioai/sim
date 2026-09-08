-- Enterprise Search and organization ownership, generated against staging 0324.
-- All steps after the enum commit are replay-safe; existing rows and workspace writers remain valid.
--> statement-breakpoint
ALTER TYPE "public"."credential_type" ADD VALUE IF NOT EXISTS 'personal_token';
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_external_directory" (
	"workspace_id" text,
	"organization_id" text,
	"provider_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"sync_lock_token" text,
	"sync_lock_lease_at" timestamp,
	"last_started_at" timestamp,
	"last_complete_sync_at" timestamp,
	CONSTRAINT "ked_owner_check" CHECK (num_nonnulls("knowledge_external_directory"."workspace_id", "knowledge_external_directory"."organization_id") = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_external_group" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"organization_id" text,
	"provider_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"external_group_id" text NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "keg_owner_check" CHECK (num_nonnulls("knowledge_external_group"."workspace_id", "knowledge_external_group"."organization_id") = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_external_group_member" (
	"group_id" text NOT NULL,
	"subject_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_external_group_member_group_id_subject_token_pk" PRIMARY KEY("group_id","subject_token")
);
--> statement-breakpoint
ALTER TABLE "credential" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "credential_group" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "encrypted_personal_token" text;
--> statement-breakpoint
ALTER TABLE "credential_group" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "acl_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "acl_verified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "source_seen_at" timestamp;
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "is_search_index" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "listing_checkpoint" jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "directory_checkpoint" jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN IF NOT EXISTS "next_directory_sync_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ADD COLUMN IF NOT EXISTS "listing_checkpoint" jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_connector_sync_log" ADD COLUMN IF NOT EXISTS "listed_count" integer;
--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "rate_limit_bucket" ADD COLUMN IF NOT EXISTS "blocked_until" timestamp;
--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_external_directory_workspace_id_workspace_id_fk' AND conrelid = '"knowledge_external_directory"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_directory" ADD CONSTRAINT "knowledge_external_directory_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_external_directory_organization_id_organization_id_fk' AND conrelid = '"knowledge_external_directory"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_directory" ADD CONSTRAINT "knowledge_external_directory_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_external_group_organization_id_organization_id_fk' AND conrelid = '"knowledge_external_group"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_group" ADD CONSTRAINT "knowledge_external_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'keg_workspace_fk' AND conrelid = '"knowledge_external_group"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_group" ADD CONSTRAINT "keg_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kegm_group_fk' AND conrelid = '"knowledge_external_group_member"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_group_member" ADD CONSTRAINT "kegm_group_fk" FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_external_group"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'copilot_chats_organization_id_organization_id_fk' AND conrelid = '"copilot_chats"'::regclass
  ) THEN
    ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_organization_id_organization_id_fk' AND conrelid = '"credential"'::regclass
  ) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_group_organization_id_organization_id_fk' AND conrelid = '"credential_group"'::regclass
  ) THEN
    ALTER TABLE "credential_group" ADD CONSTRAINT "credential_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_base_organization_id_organization_id_fk' AND conrelid = '"knowledge_base"'::regclass
  ) THEN
    ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_connector_member_organization_id_organization_id_fk' AND conrelid = '"knowledge_connector_member"'::regclass
  ) THEN
    ALTER TABLE "knowledge_connector_member" ADD CONSTRAINT "knowledge_connector_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_credential_draft_organization_id_organization_id_fk' AND conrelid = '"pending_credential_draft"'::regclass
  ) THEN
    ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_credential_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_files_organization_id_organization_id_fk' AND conrelid = '"workspace_files"'::regclass
  ) THEN
    ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'copilot_chats_owner_check' AND conrelid = '"copilot_chats"'::regclass
  ) THEN
    ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_owner_check" CHECK (num_nonnulls("copilot_chats"."workspace_id", "copilot_chats"."organization_id") <= 1) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'copilot_chats_organization_workflow_check' AND conrelid = '"copilot_chats"'::regclass
  ) THEN
    ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_organization_workflow_check" CHECK ("copilot_chats"."organization_id" IS NULL OR "copilot_chats"."workflow_id" IS NULL) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_owner_check' AND conrelid = '"credential"'::regclass
  ) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_owner_check" CHECK (num_nonnulls("credential"."workspace_id", "credential"."organization_id") = 1) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_organization_type_check' AND conrelid = '"credential"'::regclass
  ) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_organization_type_check" CHECK ("credential"."organization_id" IS NULL OR "credential"."type" IN ('oauth', 'managed_oauth', 'service_account', 'personal_token')) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_personal_token_source_check' AND conrelid = '"credential"'::regclass
  ) THEN
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
        AND authorization_app_id IS NULL
        AND encrypted_oauth_token_set IS NULL
        AND encrypted_service_account_key IS NULL
        AND unredacted = false
      )) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safe: atomically relaxes managed OAuth scope requirements for scope-less GitHub App grants; every previously valid row remains valid.
ALTER TABLE "credential"
  DROP CONSTRAINT IF EXISTS "credential_managed_oauth_source_check",
  ADD CONSTRAINT "credential_managed_oauth_source_check" CHECK ((type::text <> 'managed_oauth') OR (
        account_id IS NULL
        AND provider_id IS NOT NULL
        AND authorization_app_id IS NOT NULL
        AND provider_subject_id IS NOT NULL
        AND managed_oauth_status IS NOT NULL
        AND granted_scopes IS NOT NULL
        AND encrypted_oauth_token_set IS NOT NULL
        AND granted_at IS NOT NULL
      )) NOT VALID;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_group_owner_check' AND conrelid = '"credential_group"'::regclass
  ) THEN
    ALTER TABLE "credential_group" ADD CONSTRAINT "credential_group_owner_check" CHECK (num_nonnulls("credential_group"."workspace_id", "credential_group"."organization_id") = 1) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kb_owner_check' AND conrelid = '"knowledge_base"'::regclass
  ) THEN
    ALTER TABLE "knowledge_base" ADD CONSTRAINT "kb_owner_check" CHECK (num_nonnulls("knowledge_base"."workspace_id", "knowledge_base"."organization_id") <= 1) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kb_organization_folder_check' AND conrelid = '"knowledge_base"'::regclass
  ) THEN
    ALTER TABLE "knowledge_base" ADD CONSTRAINT "kb_organization_folder_check" CHECK ("knowledge_base"."organization_id" IS NULL OR "knowledge_base"."folder_id" IS NULL) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kcm_owner_check' AND conrelid = '"knowledge_connector_member"'::regclass
  ) THEN
    ALTER TABLE "knowledge_connector_member" ADD CONSTRAINT "kcm_owner_check" CHECK (num_nonnulls("knowledge_connector_member"."workspace_id", "knowledge_connector_member"."organization_id") = 1) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- migration-safe: atomically widens sync status to include partial progress; every deployed status remains valid.
ALTER TABLE "knowledge_connector_member_sync_log"
  DROP CONSTRAINT IF EXISTS "kcmsl_status_check",
  ADD CONSTRAINT "kcmsl_status_check" CHECK ("knowledge_connector_member_sync_log"."status" IN ('started', 'partial', 'completed', 'failed')) NOT VALID;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_draft_owner_check' AND conrelid = '"pending_credential_draft"'::regclass
  ) THEN
    ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_draft_owner_check" CHECK (num_nonnulls("pending_credential_draft"."workspace_id", "pending_credential_draft"."organization_id") = 1) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_files_organization_binding_check' AND conrelid = '"workspace_files"'::regclass
  ) THEN
    ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_organization_binding_check" CHECK ("workspace_files"."organization_id" IS NULL OR ("workspace_files"."workspace_id" IS NULL AND "workspace_files"."context" = 'knowledge-base' AND "workspace_files"."folder_id" IS NULL AND "workspace_files"."chat_id" IS NULL)) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ked_organization_id_idx" ON "knowledge_external_directory" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ked_workspace_identity_unique" ON "knowledge_external_directory" USING btree ("workspace_id","provider_id","tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ked_organization_identity_unique" ON "knowledge_external_directory" USING btree ("organization_id","provider_id","tenant_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "keg_organization_id_idx" ON "knowledge_external_group" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "keg_organization_identity_unique" ON "knowledge_external_group" USING btree ("organization_id","provider_id","tenant_id","external_group_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "keg_organization_synced_idx" ON "knowledge_external_group" USING btree ("organization_id","last_synced_at" NULLS FIRST);
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "keg_identity_unique" ON "knowledge_external_group" USING btree ("workspace_id","provider_id","tenant_id","external_group_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "keg_workspace_synced_idx" ON "knowledge_external_group" USING btree ("workspace_id","last_synced_at" NULLS FIRST);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kegm_subject_token_idx" ON "knowledge_external_group_member" USING btree ("subject_token");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_chats_organization_id_idx" ON "copilot_chats" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_chats_user_org_created_idx" ON "copilot_chats" USING btree ("user_id","organization_id","created_at","id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "credential_organization_id_idx" ON "credential" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_organization_account_unique" ON "credential" USING btree ("organization_id","account_id") WHERE "credential"."account_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_org_personal_token_unique" ON "credential" USING btree ("organization_id","created_by","provider_id","provider_tenant_id","provider_subject_id") WHERE "credential"."type" = 'personal_token';
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_personal_token_identity_unique" ON "credential" USING btree ("workspace_id","created_by","provider_id","provider_tenant_id","provider_subject_id") WHERE type = 'personal_token';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_organization_id_idx" ON "credential_group" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_organization_unique" ON "credential_group" USING btree ("organization_id");
--> statement-breakpoint
-- A failed concurrent build leaves an INVALID index that IF NOT EXISTS skips.
-- Rename only that failed index so it can be dropped concurrently outside this block.
-- The recovery name also survives interruption between the rename and drop.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('"public"."credential_group_workspace_unique_failed_0326"')
      AND (indisvalid OR indrelid <> '"public"."credential_group"'::regclass)
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected index credential_group_workspace_unique_failed_0326';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('"public"."credential_group_workspace_unique"')
      AND indrelid = '"public"."credential_group"'::regclass
      AND NOT indisvalid
  ) THEN
    ALTER INDEX "public"."credential_group_workspace_unique" RENAME TO "credential_group_workspace_unique_failed_0326";
  END IF;
END $$;
--> statement-breakpoint
-- migration-safe: Only the invalid workspace index left by 0326 is renamed above. Valid indexes and legacy uniqueness remain intact; the following statement rebuilds the failed index without removing rows.
DROP INDEX CONCURRENTLY IF EXISTS "public"."credential_group_workspace_unique_failed_0326";
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_workspace_unique" ON "credential_group" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_source_lookup_idx" ON "document" USING btree ("connector_id","external_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_connector_reconciliation_idx" ON "document" USING btree ("connector_id",COALESCE("source_seen_at", '-infinity'::timestamp),"id") WHERE "document"."user_excluded" = false AND "document"."archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag1_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag1"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag2_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag2"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag3_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag3"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag4_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag4"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag5_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag5"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag6_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag6"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_kb_tag7_lower_idx" ON "document" USING btree ("knowledge_base_id",lower("tag7"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag1_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag1"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag2_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag2"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag3_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag3"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag4_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag4"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag5_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag5"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag6_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag6"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emb_kb_tag7_lower_idx" ON "embedding" USING btree ("knowledge_base_id",lower("tag7"));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kb_organization_id_idx" ON "knowledge_base" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "kb_organization_search_index_unique" ON "knowledge_base" USING btree ("organization_id") WHERE "knowledge_base"."is_search_index" = true AND "knowledge_base"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "kb_organization_name_active_unique" ON "knowledge_base" USING btree ("organization_id","name") WHERE "knowledge_base"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "kb_workspace_search_index_unique" ON "knowledge_base" USING btree ("workspace_id") WHERE "knowledge_base"."is_search_index" = true AND "knowledge_base"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kc_directory_sync_due_idx" ON "knowledge_connector" USING btree ("next_directory_sync_at","id") WHERE "knowledge_connector"."access_mode" = 'admin' AND "knowledge_connector"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kcm_organization_id_idx" ON "knowledge_connector_member" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pending_draft_organization_id_idx" ON "pending_credential_draft" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "pending_draft_user_provider_org" ON "pending_credential_draft" USING btree ("user_id","provider_id","organization_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_email_lower_idx" ON "user" USING btree (lower(btrim("email")));
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_organization_id_idx" ON "workspace_files" USING btree ("organization_id");
--> statement-breakpoint
-- A failed concurrent build can leave an invalid index that IF NOT EXISTS skips.
-- Refuse to finish or retire an old index until every replacement is usable.
DO $$
DECLARE
  invalid_indexes text;
BEGIN
  SELECT string_agg(required.index_name, ', ' ORDER BY required.index_name)
  INTO invalid_indexes
  FROM (VALUES
    ('ked_organization_id_idx', 'knowledge_external_directory'),
    ('ked_workspace_identity_unique', 'knowledge_external_directory'),
    ('ked_organization_identity_unique', 'knowledge_external_directory'),
    ('keg_organization_id_idx', 'knowledge_external_group'),
    ('keg_organization_identity_unique', 'knowledge_external_group'),
    ('keg_organization_synced_idx', 'knowledge_external_group'),
    ('keg_identity_unique', 'knowledge_external_group'),
    ('keg_workspace_synced_idx', 'knowledge_external_group'),
    ('kegm_subject_token_idx', 'knowledge_external_group_member'),
    ('copilot_chats_organization_id_idx', 'copilot_chats'),
    ('copilot_chats_user_org_created_idx', 'copilot_chats'),
    ('credential_organization_id_idx', 'credential'),
    ('credential_organization_account_unique', 'credential'),
    ('credential_org_personal_token_unique', 'credential'),
    ('credential_personal_token_identity_unique', 'credential'),
    ('credential_group_organization_id_idx', 'credential_group'),
    ('credential_group_organization_unique', 'credential_group'),
    ('credential_group_workspace_unique', 'credential_group'),
    ('doc_connector_source_lookup_idx', 'document'),
    ('doc_connector_reconciliation_idx', 'document'),
    ('doc_kb_tag1_lower_idx', 'document'),
    ('doc_kb_tag2_lower_idx', 'document'),
    ('doc_kb_tag3_lower_idx', 'document'),
    ('doc_kb_tag4_lower_idx', 'document'),
    ('doc_kb_tag5_lower_idx', 'document'),
    ('doc_kb_tag6_lower_idx', 'document'),
    ('doc_kb_tag7_lower_idx', 'document'),
    ('emb_kb_tag1_lower_idx', 'embedding'),
    ('emb_kb_tag2_lower_idx', 'embedding'),
    ('emb_kb_tag3_lower_idx', 'embedding'),
    ('emb_kb_tag4_lower_idx', 'embedding'),
    ('emb_kb_tag5_lower_idx', 'embedding'),
    ('emb_kb_tag6_lower_idx', 'embedding'),
    ('emb_kb_tag7_lower_idx', 'embedding'),
    ('kb_organization_id_idx', 'knowledge_base'),
    ('kb_organization_search_index_unique', 'knowledge_base'),
    ('kb_organization_name_active_unique', 'knowledge_base'),
    ('kb_workspace_search_index_unique', 'knowledge_base'),
    ('kc_directory_sync_due_idx', 'knowledge_connector'),
    ('kcm_organization_id_idx', 'knowledge_connector_member'),
    ('pending_draft_organization_id_idx', 'pending_credential_draft'),
    ('pending_draft_user_provider_org', 'pending_credential_draft'),
    ('user_email_lower_idx', 'user'),
    ('workspace_files_organization_id_idx', 'workspace_files')
  ) AS required(index_name, table_name)
  LEFT JOIN pg_index actual
    ON actual.indexrelid = to_regclass(quote_ident(required.index_name))
    AND actual.indrelid = to_regclass(quote_ident(required.table_name))
  WHERE NOT COALESCE(actual.indisvalid AND actual.indisready, false);
  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Enterprise Search migration requires valid indexes: %', invalid_indexes
      USING HINT = 'Repair the listed indexes with DROP INDEX CONCURRENTLY and CREATE INDEX CONCURRENTLY, then rerun the migration.';
  END IF;
END $$;
--> statement-breakpoint
-- migration-safe: credential_group_workspace_unique enforces a single group per workspace and covers existing name uniqueness and status lookups; no data is removed.
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_workspace_status_idx";
--> statement-breakpoint
-- migration-safe: credential_group_workspace_unique enforces a single group per workspace and covers existing name uniqueness and status lookups; no data is removed.
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_workspace_name_unique";
--> statement-breakpoint
-- migration-safe: doc_connector_source_lookup_idx retains the connector_id prefix used by deployed source lookups; no constraint is removed.
DROP INDEX CONCURRENTLY IF EXISTS "doc_connector_id_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag1_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag2_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag3_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag4_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag5_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag6_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "doc_tag7_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag1_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag2_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag3_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag4_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag5_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag6_idx";
--> statement-breakpoint
-- migration-safe: the replacement KB-scoped LOWER(tag) index matches deployed document/search predicates; the old non-unique index is not named by application SQL or constraints.
DROP INDEX CONCURRENTLY IF EXISTS "emb_tag7_idx";
--> statement-breakpoint
SET lock_timeout = '5s';
--> statement-breakpoint
DO $rearm_permission_refresh$
DECLARE
  refresh_deadline timestamp := now() + interval '1 hour';
  affected integer;
BEGIN
  LOOP
    WITH due AS (
      SELECT id
      FROM knowledge_connector
      WHERE sync_interval_minutes > 0
        AND status IN ('active', 'error')
        AND archived_at IS NULL AND deleted_at IS NULL
        AND (
          (access_mode = 'admin' AND next_sync_at > refresh_deadline)
          OR (access_mode = 'members' AND member_sync_status IN ('idle', 'error')
              AND next_member_sync_at > refresh_deadline)
        )
      ORDER BY id
      LIMIT 500
      FOR UPDATE
    )
    UPDATE knowledge_connector AS connector
    SET next_sync_at = CASE WHEN connector.access_mode = 'admin'
          THEN LEAST(connector.next_sync_at, refresh_deadline) ELSE connector.next_sync_at END,
        next_member_sync_at = CASE WHEN connector.access_mode = 'members'
          THEN LEAST(connector.next_member_sync_at, refresh_deadline) ELSE connector.next_member_sync_at END
    FROM due WHERE connector.id = due.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;

  LOOP
    WITH due AS (
      SELECT member.id
      FROM knowledge_connector_member AS member
      JOIN knowledge_connector AS connector ON connector.id = member.connector_id
      WHERE connector.access_mode = 'members' AND connector.sync_interval_minutes > 0
        AND connector.status IN ('active', 'error')
        AND connector.member_sync_status IN ('idle', 'error')
        AND connector.archived_at IS NULL AND connector.deleted_at IS NULL
        AND member.status = 'active' AND member.next_attempt_at > refresh_deadline
      ORDER BY member.id
      LIMIT 500
      FOR UPDATE OF member
    )
    UPDATE knowledge_connector_member AS member
    SET next_attempt_at = refresh_deadline
    FROM due WHERE member.id = due.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$rearm_permission_refresh$;
--> statement-breakpoint
DO $identify_search_indexes$
DECLARE
  affected integer;
BEGIN
  LOOP
    WITH candidates AS (
      SELECT base.id
      FROM knowledge_base AS base
      WHERE base.name = 'Sim Search' AND base.workspace_id IS NOT NULL
        AND base.deleted_at IS NULL AND base.is_search_index = false
        AND NOT EXISTS (
          SELECT 1 FROM knowledge_base AS current_index
          WHERE current_index.workspace_id = base.workspace_id
            AND current_index.is_search_index = true AND current_index.deleted_at IS NULL
        )
      ORDER BY base.id
      LIMIT 500
      FOR UPDATE OF base
    )
    UPDATE knowledge_base AS base SET is_search_index = true
    FROM candidates WHERE base.id = candidates.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$identify_search_indexes$;
--> statement-breakpoint
-- Link pre-existing workspace personal tokens to their verified owner enrollment.
DO $$
DECLARE
  token_ids text[];
  last_id text := '';
BEGIN
  LOOP
    SELECT array_agg(id ORDER BY id), max(id) INTO token_ids, last_id
    FROM (
      SELECT id FROM credential
      WHERE type::text = 'personal_token' AND credential_group_enrollment_id IS NULL
        AND id > last_id
      ORDER BY id LIMIT 100
    ) batch;
    EXIT WHEN token_ids IS NULL;

    INSERT INTO credential_group_enrollment (
      id, credential_group_id, email, status, invitation_token_hash,
      invitation_expires_at, invited_at, created_at, updated_at
    )
    SELECT gen_random_uuid()::text, candidate.group_id, candidate.email, 'in_progress',
      encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
      now(), now(), now(), now()
    FROM (
      SELECT DISTINCT g.id AS group_id, lower(btrim(u.email)) AS email
      FROM credential c
      JOIN credential_group g ON g.workspace_id = c.workspace_id
      JOIN "user" u ON u.id = c.created_by AND u.email_verified = true
      WHERE c.id = ANY(token_ids)
    ) candidate
    ON CONFLICT (credential_group_id, email) DO NOTHING;

    UPDATE credential c SET credential_group_enrollment_id = e.id
    FROM credential_group g, credential_group_enrollment e, "user" u
    WHERE c.id = ANY(token_ids) AND c.credential_group_enrollment_id IS NULL
      AND g.workspace_id = c.workspace_id AND e.credential_group_id = g.id
      AND u.id = c.created_by AND u.email_verified = true
      AND e.email = lower(btrim(u.email));

    UPDATE credential_group_enrollment e SET status = 'in_progress', updated_at = now()
    WHERE e.status IN ('invited', 'delivery_failed') AND e.revoked_at IS NULL
      AND e.id IN (
        SELECT credential_group_enrollment_id FROM credential WHERE id = ANY(token_ids)
      );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."sync_credential_group_resource_policy"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."workspace_id" IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO "public"."resource_policy" (
      "id",
      "workspace_id",
      "resource_type",
      "resource_id",
      "revision",
      "document",
      "created_by",
      "updated_by"
    )
    VALUES (
      gen_random_uuid()::text,
      NEW."workspace_id",
      'credential_group',
      NEW."id",
      1,
      jsonb_build_object(
        'version', 1,
        'resource', jsonb_build_object('type', 'credential_group', 'id', NEW."id"),
        'statements', jsonb_build_array(
          jsonb_build_object(
            'sid', 'CredentialGroupActorCredentialAccess',
            'effect', 'allow',
            'actions', jsonb_build_array('credential_groups.credentials.use'),
            'principals', jsonb_build_array(
              jsonb_build_object('type', 'credential_group_actor')
            ),
            'condition', jsonb_build_object(
              'Bool', jsonb_build_object(
                'credential_group:ActorOwnsCredential', true
              )
            )
          )
        )
      ),
      NEW."created_by",
      NEW."created_by"
    );
    RETURN NEW;
  END IF;

  DELETE FROM "public"."resource_policy"
  WHERE "workspace_id" = OLD."workspace_id"
    AND "resource_type" = 'credential_group'
    AND "resource_id" = OLD."id";
  RETURN OLD;
END;
$$;
