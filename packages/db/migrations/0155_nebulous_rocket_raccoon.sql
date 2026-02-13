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
		('github', 'GitHub')
),
workspace_user_access AS (
	SELECT DISTINCT w.id AS workspace_id, p.user_id, p.permission_type
	FROM "permissions" p
	INNER JOIN "workspace" w ON w.id = p.entity_id
	WHERE p.entity_type = 'workspace'
	UNION
	SELECT w.id, w.owner_id, 'admin'::"permission_type"
	FROM "workspace" w
),
oauth_creds AS (
	INSERT INTO "credential" (
		"id", "workspace_id", "type", "display_name", "provider_id", "account_id",
		"created_by", "created_at", "updated_at"
	)
	SELECT
		'cred_' || md5(wua.workspace_id || ':' || a.id) AS id,
		wua.workspace_id,
		'oauth'::"credential_type",
		'Default ' || COALESCE(pn.sname, a.provider_id) || ' Credential',
		a.provider_id,
		a.id,
		a.user_id,
		now(),
		now()
	FROM "account" a
	INNER JOIN workspace_user_access wua ON wua.user_id = a.user_id
	LEFT JOIN provider_names pn ON pn.pid = a.provider_id
	WHERE a.provider_id != 'credential'
	ON CONFLICT DO NOTHING
	RETURNING id, workspace_id, account_id
)
INSERT INTO "credential_member" (
	"id", "credential_id", "user_id", "role", "status", "joined_at", "invited_by", "created_at", "updated_at"
)
SELECT
	'credm_' || md5(oc.id || ':' || wua.user_id),
	oc.id,
	wua.user_id,
	CASE WHEN a.user_id = wua.user_id THEN 'admin'::"credential_member_role" ELSE 'member'::"credential_member_role" END,
	'active'::"credential_member_status",
	now(),
	a.user_id,
	now(),
	now()
FROM oauth_creds oc
INNER JOIN "account" a ON a.id = oc.account_id
INNER JOIN workspace_user_access wua ON wua.workspace_id = oc.workspace_id
ON CONFLICT DO NOTHING;

--> statement-breakpoint
-- ----------------------------------------------------------
-- 2. Workspace environment variable credentials
-- ----------------------------------------------------------
-- For each key in workspace_environment.variables JSON,
-- create a credential. Workspace admins = admin, others = member.

WITH workspace_user_access AS (
	SELECT DISTINCT w.id AS workspace_id, p.user_id, p.permission_type
	FROM "permissions" p
	INNER JOIN "workspace" w ON w.id = p.entity_id
	WHERE p.entity_type = 'workspace'
	UNION
	SELECT w.id, w.owner_id, 'admin'::"permission_type"
	FROM "workspace" w
),
ws_env_keys AS (
	SELECT
		we.workspace_id,
		key AS env_key,
		w.owner_id
	FROM "workspace_environment" we
	INNER JOIN "workspace" w ON w.id = we.workspace_id
	CROSS JOIN LATERAL json_object_keys(we.variables::json) AS key
),
ws_env_creds AS (
	INSERT INTO "credential" (
		"id", "workspace_id", "type", "display_name", "env_key",
		"created_by", "created_at", "updated_at"
	)
	SELECT
		'cred_' || md5(wek.workspace_id || ':env_workspace:' || wek.env_key),
		wek.workspace_id,
		'env_workspace'::"credential_type",
		wek.env_key,
		wek.env_key,
		wek.owner_id,
		now(),
		now()
	FROM ws_env_keys wek
	ON CONFLICT DO NOTHING
	RETURNING id, workspace_id
)
INSERT INTO "credential_member" (
	"id", "credential_id", "user_id", "role", "status", "joined_at", "invited_by", "created_at", "updated_at"
)
SELECT
	'credm_' || md5(wec.id || ':' || wua.user_id),
	wec.id,
	wua.user_id,
	CASE WHEN wua.permission_type = 'admin' THEN 'admin'::"credential_member_role" ELSE 'member'::"credential_member_role" END,
	'active'::"credential_member_status",
	now(),
	(SELECT w.owner_id FROM "workspace" w WHERE w.id = wec.workspace_id LIMIT 1),
	now(),
	now()
FROM ws_env_creds wec
INNER JOIN workspace_user_access wua ON wua.workspace_id = wec.workspace_id
ON CONFLICT DO NOTHING;

--> statement-breakpoint
-- ----------------------------------------------------------
-- 3. Personal environment variable credentials
-- ----------------------------------------------------------
-- For each key in environment.variables JSON, for each workspace
-- the user belongs to, create a credential with the user as admin.

WITH workspace_user_access AS (
	SELECT DISTINCT w.id AS workspace_id, p.user_id
	FROM "permissions" p
	INNER JOIN "workspace" w ON w.id = p.entity_id
	WHERE p.entity_type = 'workspace'
	UNION
	SELECT w.id, w.owner_id
	FROM "workspace" w
),
personal_env_keys AS (
	SELECT
		e.user_id,
		key AS env_key
	FROM "environment" e
	CROSS JOIN LATERAL json_object_keys(e.variables::json) AS key
),
personal_env_creds AS (
	INSERT INTO "credential" (
		"id", "workspace_id", "type", "display_name", "env_key", "env_owner_user_id",
		"created_by", "created_at", "updated_at"
	)
	SELECT
		'cred_' || md5(wua.workspace_id || ':env_personal:' || pek.env_key || ':' || pek.user_id),
		wua.workspace_id,
		'env_personal'::"credential_type",
		pek.env_key,
		pek.env_key,
		pek.user_id,
		pek.user_id,
		now(),
		now()
	FROM personal_env_keys pek
	INNER JOIN workspace_user_access wua ON wua.user_id = pek.user_id
	ON CONFLICT DO NOTHING
	RETURNING id, workspace_id
)
INSERT INTO "credential_member" (
	"id", "credential_id", "user_id", "role", "status", "joined_at", "invited_by", "created_at", "updated_at"
)
SELECT
	'credm_' || md5(pec.id || ':' || c.env_owner_user_id),
	pec.id,
	c.env_owner_user_id,
	'admin'::"credential_member_role",
	'active'::"credential_member_status",
	now(),
	c.env_owner_user_id,
	now(),
	now()
FROM personal_env_creds pec
INNER JOIN "credential" c ON c.id = pec.id
ON CONFLICT DO NOTHING;