-- ============================================================
-- Triggers for user_table_rows (from 0156 schema addition)
-- Drizzle does not generate trigger SQL, so they are applied here.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_user_table_row_count()
RETURNS TRIGGER AS $$
DECLARE
    current_count INTEGER;
    max_allowed INTEGER;
BEGIN
    SELECT row_count, max_rows INTO current_count, max_allowed
    FROM user_table_definitions
    WHERE id = NEW.table_id;

    IF current_count >= max_allowed THEN
        RAISE EXCEPTION 'Maximum row limit (%) reached for table %', max_allowed, NEW.table_id;
    END IF;

    UPDATE user_table_definitions
    SET row_count = row_count + 1,
        updated_at = now()
    WHERE id = NEW.table_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION decrement_user_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions
    SET row_count = GREATEST(row_count - 1, 0),
        updated_at = now()
    WHERE id = OLD.table_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER user_table_rows_insert_trigger
    BEFORE INSERT ON user_table_rows
    FOR EACH ROW
    EXECUTE FUNCTION increment_user_table_row_count();
--> statement-breakpoint

CREATE TRIGGER user_table_rows_delete_trigger
    AFTER DELETE ON user_table_rows
    FOR EACH ROW
    EXECUTE FUNCTION decrement_user_table_row_count();
--> statement-breakpoint

-- ============================================================
-- Credential system schema + backfill
-- ============================================================

CREATE TYPE "public"."credential_member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."credential_member_status" AS ENUM('active', 'pending', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."credential_type" AS ENUM('oauth', 'env_workspace', 'env_personal');--> statement-breakpoint
CREATE TABLE "credential" (
    "id" text PRIMARY KEY NOT NULL,
    "workspace_id" text NOT NULL,
    "type" "credential_type" NOT NULL,
    "display_name" text NOT NULL,
    "description" text,
    "provider_id" text,
    "account_id" text,
    "env_key" text,
    "env_owner_user_id" text,
    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "credential_oauth_source_check" CHECK ((type <> 'oauth') OR (account_id IS NOT NULL AND provider_id IS NOT NULL)),
    CONSTRAINT "credential_workspace_env_source_check" CHECK ((type <> 'env_workspace') OR (env_key IS NOT NULL AND env_owner_user_id IS NULL)),
    CONSTRAINT "credential_personal_env_source_check" CHECK ((type <> 'env_personal') OR (env_key IS NOT NULL AND env_owner_user_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "credential_member" (
    "id" text PRIMARY KEY NOT NULL,
    "credential_id" text NOT NULL,
    "user_id" text NOT NULL,
    "role" "credential_member_role" DEFAULT 'member' NOT NULL,
    "status" "credential_member_status" DEFAULT 'active' NOT NULL,
    "joined_at" timestamp,
    "invited_by" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_credential_draft" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "workspace_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "display_name" text NOT NULL,
    "description" text,
    "credential_id" text,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "account_user_provider_unique";--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_env_owner_user_id_user_id_fk" FOREIGN KEY ("env_owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_credential_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_credential_draft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_credential_draft_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_workspace_id_idx" ON "credential" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credential_type_idx" ON "credential" USING btree ("type");--> statement-breakpoint
CREATE INDEX "credential_provider_id_idx" ON "credential" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "credential_account_id_idx" ON "credential" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credential_env_owner_user_id_idx" ON "credential" USING btree ("env_owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workspace_account_unique" ON "credential" USING btree ("workspace_id","account_id") WHERE account_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workspace_env_unique" ON "credential" USING btree ("workspace_id","type","env_key") WHERE type = 'env_workspace';--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workspace_personal_env_unique" ON "credential" USING btree ("workspace_id","type","env_key","env_owner_user_id") WHERE type = 'env_personal';--> statement-breakpoint
CREATE INDEX "credential_member_credential_id_idx" ON "credential_member" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "credential_member_user_id_idx" ON "credential_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credential_member_role_idx" ON "credential_member" USING btree ("role");--> statement-breakpoint
CREATE INDEX "credential_member_status_idx" ON "credential_member" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_member_unique" ON "credential_member" USING btree ("credential_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_draft_user_provider_ws" ON "pending_credential_draft" USING btree ("user_id","provider_id","workspace_id");
--> statement-breakpoint
-- ============================================================
-- BACKFILL: Create credentials and members from existing data
-- ============================================================

-- Helper CTE: all workspace members (from permissions + workspace owners)
-- Used by all three backfill sections below.

-- ----------------------------------------------------------
-- 1. OAuth credentials
-- ----------------------------------------------------------
-- For each (account, workspace) where account owner has workspace access,
-- create a "Default <Service Name> Credential".
-- Account owner = admin, other workspace members = member.

WITH provider_names(pid, sname) AS (
    VALUES
        ('google-email', 'Gmail'),
        ('google-drive', 'Google Drive'),
        ('google-docs', 'Google Docs'),
        ('google-sheets', 'Google Sheets'),
        ('google-forms', 'Google Forms'),
        ('google-calendar', 'Google Calendar'),
        ('google-vault', 'Google Vault'),
        ('google-slides', 'Google Slides'),
        ('google-groups', 'Google Groups'),
        ('slack', 'Slack'),
        ('notion', 'Notion'),
        ('confluence', 'Confluence'),
        ('jira', 'Jira'),
        ('jira-service-management', 'Jira Service Management'),
        ('linear', 'Linear'),
        ('airtable', 'Airtable'),
        ('asana', 'Asana'),
        ('hubspot', 'HubSpot'),
        ('salesforce', 'Salesforce'),
        ('pipedrive', 'Pipedrive'),
        ('microsoft-teams', 'Microsoft Teams'),
        ('microsoft-planner', 'Microsoft Planner'),
        ('microsoft-excel', 'Microsoft Excel'),
        ('outlook', 'Outlook'),
        ('onedrive', 'OneDrive'),
        ('sharepoint', 'SharePoint'),
        ('dropbox', 'Dropbox'),
        ('wordpress', 'WordPress'),
        ('webflow', 'Webflow'),
        ('wealthbox', 'Wealthbox'),
        ('spotify', 'Spotify'),
        ('x', 'X'),
        ('reddit', 'Reddit'),
        ('linkedin', 'LinkedIn'),
        ('trello', 'Trello'),
        ('shopify', 'Shopify'),
        ('zoom', 'Zoom'),
        ('calcom', 'Cal.com'),
        ('discord', 'Discord'),
        ('box', 'Box'),
        ('github-repo', 'GitHub'),
        ('vertex-ai', 'Vertex AI'),
        ('supabase', 'Supabase')
),
oauth_targets AS (
    SELECT
        'cred_' || md5(wua.workspace_id || ':' || a.id) AS cred_id,
        wua.workspace_id,
        a.id AS account_id,
        a.user_id AS account_owner_id,
        a.provider_id,
        COALESCE(u.name, 'User') || '''s ' || COALESCE(pn.sname, a.provider_id) AS display_name
    FROM "account" a
    INNER JOIN (
        SELECT DISTINCT w.id AS workspace_id, p.user_id
        FROM "permissions" p
        INNER JOIN "workspace" w ON w.id = p.entity_id
        WHERE p.entity_type = 'workspace'
        UNION
        SELECT w.id, w.owner_id FROM "workspace" w
    ) wua ON wua.user_id = a.user_id
    INNER JOIN "user" u ON u.id = a.user_id
    LEFT JOIN provider_names pn ON pn.pid = a.provider_id
    WHERE a.provider_id NOT IN ('credential', 'github', 'google')
),
oauth_workspace_members AS (
    SELECT DISTINCT w.id AS workspace_id, p.user_id
    FROM "permissions" p
    INNER JOIN "workspace" w ON w.id = p.entity_id
    WHERE p.entity_type = 'workspace'
    UNION
    SELECT w.id, w.owner_id FROM "workspace" w
),
_oauth_insert AS (
    INSERT INTO "credential" (
        "id", "workspace_id", "type", "display_name", "provider_id", "account_id",
        "created_by", "created_at", "updated_at"
    )
    SELECT cred_id, workspace_id, 'oauth'::"credential_type", display_name,
           provider_id, account_id, account_owner_id, now(), now()
    FROM oauth_targets
    ON CONFLICT DO NOTHING
)
INSERT INTO "credential_member" (
    "id", "credential_id", "user_id", "role", "status", "joined_at", "invited_by", "created_at", "updated_at"
)
SELECT
    'credm_' || md5(ot.cred_id || ':' || owm.user_id),
    ot.cred_id,
    owm.user_id,
    CASE WHEN ot.account_owner_id = owm.user_id THEN 'admin'::"credential_member_role" ELSE 'member'::"credential_member_role" END,
    'active'::"credential_member_status",
    now(),
    ot.account_owner_id,
    now(),
    now()
FROM oauth_targets ot
INNER JOIN oauth_workspace_members owm ON owm.workspace_id = ot.workspace_id
ON CONFLICT DO NOTHING;

--> statement-breakpoint
-- ----------------------------------------------------------
-- 2. Workspace environment variable credentials
-- ----------------------------------------------------------
-- For each key in workspace_environment.variables JSON,
-- create a credential. Workspace admins = admin, others = member.

WITH ws_env_keys AS (
    SELECT
        we.workspace_id,
        key AS env_key,
        w.owner_id
    FROM "workspace_environment" we
    INNER JOIN "workspace" w ON w.id = we.workspace_id
    CROSS JOIN LATERAL json_object_keys(we.variables::json) AS key
),
ws_env_targets AS (
    SELECT
        'cred_' || md5(wek.workspace_id || ':env_workspace:' || wek.env_key) AS cred_id,
        wek.workspace_id,
        wek.env_key,
        wek.owner_id
    FROM ws_env_keys wek
),
ws_workspace_members AS (
    SELECT DISTINCT ON (workspace_id, user_id)
        workspace_id, user_id, permission_type
    FROM (
        SELECT w.id AS workspace_id, p.user_id, p.permission_type
        FROM "permissions" p
        INNER JOIN "workspace" w ON w.id = p.entity_id
        WHERE p.entity_type = 'workspace'
        UNION ALL
        SELECT w.id, w.owner_id, 'admin'::"permission_type"
        FROM "workspace" w
    ) sub
    ORDER BY workspace_id, user_id, (permission_type = 'admin') DESC
),
_ws_env_insert AS (
    INSERT INTO "credential" (
        "id", "workspace_id", "type", "display_name", "env_key",
        "created_by", "created_at", "updated_at"
    )
    SELECT cred_id, workspace_id, 'env_workspace'::"credential_type",
           env_key, env_key, owner_id, now(), now()
    FROM ws_env_targets
    ON CONFLICT DO NOTHING
)
INSERT INTO "credential_member" (
    "id", "credential_id", "user_id", "role", "status", "joined_at", "invited_by", "created_at", "updated_at"
)
SELECT
    'credm_' || md5(wet.cred_id || ':' || wm.user_id),
    wet.cred_id,
    wm.user_id,
    CASE WHEN wm.permission_type = 'admin' THEN 'admin'::"credential_member_role" ELSE 'member'::"credential_member_role" END,
    'active'::"credential_member_status",
    now(),
    wet.owner_id,
    now(),
    now()
FROM ws_env_targets wet
INNER JOIN ws_workspace_members wm ON wm.workspace_id = wet.workspace_id
ON CONFLICT DO NOTHING;

--> statement-breakpoint
-- ----------------------------------------------------------
-- 3. Personal environment variable credentials
-- ----------------------------------------------------------
-- For each key in environment.variables JSON, for each workspace
-- the user belongs to, create a credential with the user as admin.

WITH personal_env_keys AS (
    SELECT
        e.user_id,
        key AS env_key
    FROM "environment" e
    CROSS JOIN LATERAL json_object_keys(e.variables::json) AS key
),
personal_env_targets AS (
    SELECT
        'cred_' || md5(wua.workspace_id || ':env_personal:' || pek.env_key || ':' || pek.user_id) AS cred_id,
        wua.workspace_id,
        pek.env_key,
        pek.user_id
    FROM personal_env_keys pek
    INNER JOIN (
        SELECT DISTINCT w.id AS workspace_id, p.user_id
        FROM "permissions" p
        INNER JOIN "workspace" w ON w.id = p.entity_id
        WHERE p.entity_type = 'workspace'
        UNION
        SELECT w.id, w.owner_id FROM "workspace" w
    ) wua ON wua.user_id = pek.user_id
),
_personal_env_insert AS (
    INSERT INTO "credential" (
        "id", "workspace_id", "type", "display_name", "env_key", "env_owner_user_id",
        "created_by", "created_at", "updated_at"
    )
    SELECT cred_id, workspace_id, 'env_personal'::"credential_type",
           env_key, env_key, user_id, user_id, now(), now()
    FROM personal_env_targets
    ON CONFLICT DO NOTHING
)
INSERT INTO "credential_member" (
    "id", "credential_id", "user_id", "role", "status", "joined_at", "invited_by", "created_at", "updated_at"
)
SELECT
    'credm_' || md5(pet.cred_id || ':' || pet.user_id),
    pet.cred_id,
    pet.user_id,
    'admin'::"credential_member_role",
    'active'::"credential_member_status",
    now(),
    pet.user_id,
    now(),
    now()
FROM personal_env_targets pet
ON CONFLICT DO NOTHING;