ALTER TABLE "credential" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "credential_group" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_external_group" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "credential_group" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_external_directory" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_external_group" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'copilot_chats_organization_id_organization_id_fk' AND conrelid = '"public"."copilot_chats"'::regclass
  ) THEN
    ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_organization_id_organization_id_fk' AND conrelid = '"public"."credential"'::regclass
  ) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_group_organization_id_organization_id_fk' AND conrelid = '"public"."credential_group"'::regclass
  ) THEN
    ALTER TABLE "credential_group" ADD CONSTRAINT "credential_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_base_organization_id_organization_id_fk' AND conrelid = '"public"."knowledge_base"'::regclass
  ) THEN
    ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_connector_member_organization_id_organization_id_fk' AND conrelid = '"public"."knowledge_connector_member"'::regclass
  ) THEN
    ALTER TABLE "knowledge_connector_member" ADD CONSTRAINT "knowledge_connector_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_external_directory_organization_id_organization_id_fk' AND conrelid = '"public"."knowledge_external_directory"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_directory" ADD CONSTRAINT "knowledge_external_directory_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_external_group_organization_id_organization_id_fk' AND conrelid = '"public"."knowledge_external_group"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_group" ADD CONSTRAINT "knowledge_external_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_credential_draft_organization_id_organization_id_fk' AND conrelid = '"public"."pending_credential_draft"'::regclass
  ) THEN
    ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_credential_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'copilot_chats_owner_check' AND conrelid = '"public"."copilot_chats"'::regclass
  ) THEN
    ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_owner_check" CHECK (num_nonnulls("copilot_chats"."workspace_id", "copilot_chats"."organization_id") <= 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'copilot_chats_organization_workflow_check' AND conrelid = '"public"."copilot_chats"'::regclass
  ) THEN
    ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_organization_workflow_check" CHECK ("copilot_chats"."organization_id" IS NULL OR "copilot_chats"."workflow_id" IS NULL) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_owner_check' AND conrelid = '"public"."credential"'::regclass
  ) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_owner_check" CHECK (num_nonnulls("credential"."workspace_id", "credential"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_organization_type_check' AND conrelid = '"public"."credential"'::regclass
  ) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_organization_type_check" CHECK ("credential"."organization_id" IS NULL OR "credential"."type" IN ('oauth', 'managed_oauth', 'service_account', 'personal_token')) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_group_owner_check' AND conrelid = '"public"."credential_group"'::regclass
  ) THEN
    ALTER TABLE "credential_group" ADD CONSTRAINT "credential_group_owner_check" CHECK (num_nonnulls("credential_group"."workspace_id", "credential_group"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kb_owner_check' AND conrelid = '"public"."knowledge_base"'::regclass
  ) THEN
    ALTER TABLE "knowledge_base" ADD CONSTRAINT "kb_owner_check" CHECK (num_nonnulls("knowledge_base"."workspace_id", "knowledge_base"."organization_id") <= 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kb_organization_folder_check' AND conrelid = '"public"."knowledge_base"'::regclass
  ) THEN
    ALTER TABLE "knowledge_base" ADD CONSTRAINT "kb_organization_folder_check" CHECK ("knowledge_base"."organization_id" IS NULL OR "knowledge_base"."folder_id" IS NULL) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kcm_owner_check' AND conrelid = '"public"."knowledge_connector_member"'::regclass
  ) THEN
    ALTER TABLE "knowledge_connector_member" ADD CONSTRAINT "kcm_owner_check" CHECK (num_nonnulls("knowledge_connector_member"."workspace_id", "knowledge_connector_member"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ked_owner_check' AND conrelid = '"public"."knowledge_external_directory"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_directory" ADD CONSTRAINT "ked_owner_check" CHECK (num_nonnulls("knowledge_external_directory"."workspace_id", "knowledge_external_directory"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'keg_owner_check' AND conrelid = '"public"."knowledge_external_group"'::regclass
  ) THEN
    ALTER TABLE "knowledge_external_group" ADD CONSTRAINT "keg_owner_check" CHECK (num_nonnulls("knowledge_external_group"."workspace_id", "knowledge_external_group"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_draft_owner_check' AND conrelid = '"public"."pending_credential_draft"'::regclass
  ) THEN
    ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_draft_owner_check" CHECK (num_nonnulls("pending_credential_draft"."workspace_id", "pending_credential_draft"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_files_organization_id_organization_id_fk' AND conrelid = '"public"."workspace_files"'::regclass
  ) THEN
    ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_files_organization_binding_check' AND conrelid = '"public"."workspace_files"'::regclass
  ) THEN
    ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_organization_binding_check" CHECK ("workspace_files"."organization_id" IS NULL OR ("workspace_files"."workspace_id" IS NULL AND "workspace_files"."context" = 'knowledge-base' AND "workspace_files"."folder_id" IS NULL AND "workspace_files"."chat_id" IS NULL)) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
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
CREATE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_organization_id_idx" ON "credential_group" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_organization_unique" ON "credential_group" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kb_organization_id_idx" ON "knowledge_base" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "kb_organization_search_index_unique" ON "knowledge_base" USING btree ("organization_id") WHERE "knowledge_base"."is_search_index" = true AND "knowledge_base"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "kb_organization_name_active_unique" ON "knowledge_base" USING btree ("organization_id","name") WHERE "knowledge_base"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kcm_organization_id_idx" ON "knowledge_connector_member" USING btree ("organization_id");
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
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pending_draft_organization_id_idx" ON "pending_credential_draft" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "pending_draft_user_provider_org" ON "pending_credential_draft" USING btree ("user_id","provider_id","organization_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workspace_files_organization_id_idx" ON "workspace_files" USING btree ("organization_id");
--> statement-breakpoint
BEGIN;
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
DECLARE
  invalid_indexes text;
BEGIN
  SELECT string_agg(required.index_name, ', ' ORDER BY required.index_name)
  INTO invalid_indexes
  FROM (
    VALUES
      ('"public"."copilot_chats_organization_id_idx"', '"public"."copilot_chats"'),
      ('"public"."copilot_chats_user_org_created_idx"', '"public"."copilot_chats"'),
      ('"public"."credential_organization_id_idx"', '"public"."credential"'),
      ('"public"."credential_organization_account_unique"', '"public"."credential"'),
      ('"public"."credential_org_personal_token_unique"', '"public"."credential"'),
      ('"public"."credential_group_organization_id_idx"', '"public"."credential_group"'),
      ('"public"."credential_group_organization_unique"', '"public"."credential_group"'),
      ('"public"."kb_organization_id_idx"', '"public"."knowledge_base"'),
      ('"public"."kb_organization_search_index_unique"', '"public"."knowledge_base"'),
      ('"public"."kb_organization_name_active_unique"', '"public"."knowledge_base"'),
      ('"public"."kcm_organization_id_idx"', '"public"."knowledge_connector_member"'),
      ('"public"."ked_organization_id_idx"', '"public"."knowledge_external_directory"'),
      ('"public"."ked_workspace_identity_unique"', '"public"."knowledge_external_directory"'),
      ('"public"."ked_organization_identity_unique"', '"public"."knowledge_external_directory"'),
      ('"public"."keg_organization_id_idx"', '"public"."knowledge_external_group"'),
      ('"public"."keg_organization_identity_unique"', '"public"."knowledge_external_group"'),
      ('"public"."keg_organization_synced_idx"', '"public"."knowledge_external_group"'),
      ('"public"."pending_draft_organization_id_idx"', '"public"."pending_credential_draft"'),
      ('"public"."pending_draft_user_provider_org"', '"public"."pending_credential_draft"'),
      ('"public"."workspace_files_organization_id_idx"', '"public"."workspace_files"')
  ) AS required(index_name, table_name)
  LEFT JOIN pg_index AS actual
    ON actual.indexrelid = to_regclass(required.index_name)
    AND actual.indrelid = to_regclass(required.table_name)
  WHERE NOT COALESCE(actual.indisvalid AND actual.indisready, false);

  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Organization Search migration requires valid indexes: %', invalid_indexes
      USING HINT = 'Repair the listed indexes with DROP INDEX CONCURRENTLY and CREATE INDEX CONCURRENTLY, then rerun the migration.';
  END IF;
END;
$$;
--> statement-breakpoint
-- migration-safe: Replaced by ked_workspace_identity_unique above; existing 7477 writers use ON CONFLICT(workspace_id, provider_id, tenant_id), never the constraint name, so their uniqueness and upserts remain intact. No rows or columns are removed.
ALTER TABLE "knowledge_external_directory" DROP CONSTRAINT IF EXISTS "ked_identity_pk";
--> statement-breakpoint
ALTER TABLE "knowledge_external_directory" ALTER COLUMN "workspace_id" DROP NOT NULL;

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
