SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- migration-safe: Replaces the organization credential type check with a superset including managed_mcp; old writers remain valid and no data is removed.
ALTER TABLE "credential" DROP CONSTRAINT IF EXISTS "credential_organization_type_check";
--> statement-breakpoint
ALTER TABLE "mcp_server_oauth" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "mcp_servers" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "resource_policy" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN IF NOT EXISTS "mcp_oauth_config_version" integer;
--> statement-breakpoint
ALTER TABLE "credential_group_enrollment" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "mcp_server_oauth" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_config_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "resource_policy" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_group_enrollment_user_id_user_id_fk' AND conrelid = '"public"."credential_group_enrollment"'::regclass) THEN
    ALTER TABLE "credential_group_enrollment" ADD CONSTRAINT "credential_group_enrollment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_server_oauth_organization_id_organization_id_fk' AND conrelid = '"public"."mcp_server_oauth"'::regclass) THEN
    ALTER TABLE "mcp_server_oauth" ADD CONSTRAINT "mcp_server_oauth_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_servers_organization_id_organization_id_fk' AND conrelid = '"public"."mcp_servers"'::regclass) THEN
    ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_policy_organization_id_organization_id_fk' AND conrelid = '"public"."resource_policy"'::regclass) THEN
    ALTER TABLE "resource_policy" ADD CONSTRAINT "resource_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_organization_type_check' AND conrelid = '"public"."credential"'::regclass) THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_organization_type_check" CHECK ("credential"."organization_id" IS NULL OR "credential"."type" IN ('oauth', 'managed_oauth', 'managed_mcp', 'service_account', 'personal_token')) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_server_oauth_owner_check' AND conrelid = '"public"."mcp_server_oauth"'::regclass) THEN
    ALTER TABLE "mcp_server_oauth" ADD CONSTRAINT "mcp_server_oauth_owner_check" CHECK (num_nonnulls("mcp_server_oauth"."workspace_id", "mcp_server_oauth"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_servers_owner_check' AND conrelid = '"public"."mcp_servers"'::regclass) THEN
    ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_owner_check" CHECK (num_nonnulls("mcp_servers"."workspace_id", "mcp_servers"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_servers_organization_managed_check' AND conrelid = '"public"."mcp_servers"'::regclass) THEN
    ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_organization_managed_check" CHECK ("mcp_servers"."organization_id" IS NULL OR "mcp_servers"."credential_group_id" IS NOT NULL) NOT VALID;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_policy_owner_check' AND conrelid = '"public"."resource_policy"'::regclass) THEN
    ALTER TABLE "resource_policy" ADD CONSTRAINT "resource_policy_owner_check" CHECK (num_nonnulls("resource_policy"."workspace_id", "resource_policy"."organization_id") = 1) NOT VALID;
  END IF;
END;
$$;
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
  WHERE ("workspace_id" = OLD."workspace_id" OR "organization_id" = OLD."organization_id")
    AND "resource_type" = 'credential_group'
    AND "resource_id" = OLD."id";
  RETURN OLD;
END;
$$;

--> statement-breakpoint
COMMIT;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_enrollment_group_user_unique" ON "credential_group_enrollment" USING btree ("credential_group_id","user_id") WHERE "credential_group_enrollment"."user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "credential_group_enrollment_user_id_idx" ON "credential_group_enrollment" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "mcp_servers_organization_id_idx" ON "mcp_servers" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "resource_policy_organization_id_idx" ON "resource_policy" USING btree ("organization_id");
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
BEGIN;
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
DECLARE invalid_indexes text;
BEGIN
  SELECT string_agg(required.index_name, ', ' ORDER BY required.index_name) INTO invalid_indexes
  FROM (VALUES
    ('"public"."credential_group_enrollment_group_user_unique"', '"public"."credential_group_enrollment"'),
    ('"public"."credential_group_enrollment_user_id_idx"', '"public"."credential_group_enrollment"'),
    ('"public"."mcp_servers_organization_id_idx"', '"public"."mcp_servers"'),
    ('"public"."resource_policy_organization_id_idx"', '"public"."resource_policy"')
  ) AS required(index_name, table_name)
  LEFT JOIN pg_index AS actual ON actual.indexrelid = to_regclass(required.index_name) AND actual.indrelid = to_regclass(required.table_name)
  WHERE NOT COALESCE(actual.indisvalid AND actual.indisready, false);
  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Connected accounts migration requires valid indexes: %', invalid_indexes
      USING HINT = 'Repair listed indexes with DROP INDEX CONCURRENTLY and CREATE INDEX CONCURRENTLY, then rerun.';
  END IF;
END;
$$;
