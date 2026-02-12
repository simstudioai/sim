CREATE TYPE "public"."credential_member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."credential_member_status" AS ENUM('active', 'pending', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."credential_type" AS ENUM('oauth', 'env_workspace', 'env_personal');--> statement-breakpoint
CREATE TABLE "credential" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "credential_type" NOT NULL,
	"display_name" text NOT NULL,
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
ALTER TABLE "credential" ADD CONSTRAINT "credential_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_env_owner_user_id_user_id_fk" FOREIGN KEY ("env_owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
CREATE UNIQUE INDEX "credential_member_unique" ON "credential_member" USING btree ("credential_id","user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_credential_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"display_name" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_credential_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ADD CONSTRAINT "pending_credential_draft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_draft_user_provider_ws" ON "pending_credential_draft" USING btree ("user_id","provider_id","workspace_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "account_user_provider_unique";
--> statement-breakpoint
WITH workspace_user_access AS (
	SELECT DISTINCT w.id AS workspace_id, p.user_id
	FROM "permissions" p
	INNER JOIN "workspace" w
		ON w.id = p.entity_id
	WHERE p.entity_type = 'workspace'
	UNION
	SELECT w.id AS workspace_id, w.owner_id AS user_id
	FROM "workspace" w
	UNION
	SELECT DISTINCT wf.workspace_id AS workspace_id, wf.user_id
	FROM "workflow" wf
	INNER JOIN "workspace" w
		ON w.id = wf.workspace_id
	WHERE wf.workspace_id IS NOT NULL
)
INSERT INTO "credential" (
	"id",
	"workspace_id",
	"type",
	"display_name",
	"provider_id",
	"account_id",
	"created_by",
	"created_at",
	"updated_at"
)
SELECT
	'cred_' || md5('oauth:' || wua.workspace_id || ':' || a.id) AS id,
	wua.workspace_id,
	'oauth'::"credential_type",
	COALESCE(NULLIF(a.account_id, ''), a.provider_id) AS display_name,
	a.provider_id,
	a.id,
	a.user_id,
	now(),
	now()
FROM "account" a
INNER JOIN workspace_user_access wua
	ON wua.user_id = a.user_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "credential" (
	"id",
	"workspace_id",
	"type",
	"display_name",
	"env_key",
	"created_by",
	"created_at",
	"updated_at"
)
SELECT
	'cred_' || md5('env_workspace:' || we.workspace_id || ':' || env.key) AS id,
	we.workspace_id,
	'env_workspace'::"credential_type",
	env.key AS display_name,
	env.key,
	COALESCE(wf_owner.user_id, w.owner_id),
	now(),
	now()
FROM "workspace_environment" we
INNER JOIN "workspace" w
	ON w.id = we.workspace_id
LEFT JOIN LATERAL (
	SELECT wf.user_id
	FROM "workflow" wf
	WHERE wf.workspace_id = we.workspace_id
	ORDER BY wf.created_at ASC
	LIMIT 1
) wf_owner
	ON TRUE
CROSS JOIN LATERAL jsonb_each_text(COALESCE(we.variables::jsonb, '{}'::jsonb)) AS env(key, value)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
WITH workflow_workspace_owners AS (
	SELECT DISTINCT wf.workspace_id, wf.user_id
	FROM "workflow" wf
	INNER JOIN "workspace" w
		ON w.id = wf.workspace_id
	WHERE wf.workspace_id IS NOT NULL
)
INSERT INTO "credential" (
	"id",
	"workspace_id",
	"type",
	"display_name",
	"env_key",
	"env_owner_user_id",
	"created_by",
	"created_at",
	"updated_at"
)
SELECT
	'cred_' || md5('env_personal:' || wwo.workspace_id || ':' || e.user_id || ':' || env.key) AS id,
	wwo.workspace_id,
	'env_personal'::"credential_type",
	env.key AS display_name,
	env.key,
	e.user_id,
	e.user_id,
	now(),
	now()
FROM "environment" e
INNER JOIN workflow_workspace_owners wwo
	ON wwo.user_id = e.user_id
CROSS JOIN LATERAL jsonb_each_text(COALESCE(e.variables::jsonb, '{}'::jsonb)) AS env(key, value)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
WITH workspace_user_access AS (
	SELECT DISTINCT w.id AS workspace_id, p.user_id
	FROM "permissions" p
	INNER JOIN "workspace" w
		ON w.id = p.entity_id
	WHERE p.entity_type = 'workspace'
	UNION
	SELECT w.id AS workspace_id, w.owner_id AS user_id
	FROM "workspace" w
	UNION
	SELECT DISTINCT wf.workspace_id AS workspace_id, wf.user_id
	FROM "workflow" wf
	INNER JOIN "workspace" w
		ON w.id = wf.workspace_id
	WHERE wf.workspace_id IS NOT NULL
),
workflow_workspace_owners AS (
	SELECT DISTINCT wf.workspace_id, wf.user_id
	FROM "workflow" wf
	INNER JOIN "workspace" w
		ON w.id = wf.workspace_id
	WHERE wf.workspace_id IS NOT NULL
)
INSERT INTO "credential_member" (
	"id",
	"credential_id",
	"user_id",
	"role",
	"status",
	"joined_at",
	"invited_by",
	"created_at",
	"updated_at"
)
SELECT
	'credm_' || md5(c.id || ':' || wua.user_id) AS id,
	c.id,
	wua.user_id,
	CASE
		WHEN c.type = 'oauth'::"credential_type" AND c.created_by = wua.user_id THEN 'admin'::"credential_member_role"
		WHEN c.type = 'env_workspace'::"credential_type" AND (
			EXISTS (
				SELECT 1
				FROM workflow_workspace_owners wwo
				WHERE wwo.workspace_id = c.workspace_id
					AND wwo.user_id = wua.user_id
			)
			OR (
				NOT EXISTS (
					SELECT 1
					FROM workflow_workspace_owners wwo
					WHERE wwo.workspace_id = c.workspace_id
				)
				AND w.owner_id = wua.user_id
			)
		) THEN 'admin'::"credential_member_role"
		ELSE 'member'::"credential_member_role"
	END AS role,
	'active'::"credential_member_status",
	now(),
	c.created_by,
	now(),
	now()
FROM "credential" c
INNER JOIN "workspace" w
	ON w.id = c.workspace_id
INNER JOIN workspace_user_access wua
	ON wua.workspace_id = c.workspace_id
WHERE c.type IN ('oauth'::"credential_type", 'env_workspace'::"credential_type")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "credential_member" (
	"id",
	"credential_id",
	"user_id",
	"role",
	"status",
	"joined_at",
	"invited_by",
	"created_at",
	"updated_at"
)
SELECT
	'credm_' || md5(c.id || ':' || c.env_owner_user_id) AS id,
	c.id,
	c.env_owner_user_id,
	'admin'::"credential_member_role",
	'active'::"credential_member_status",
	now(),
	c.created_by,
	now(),
	now()
FROM "credential" c
WHERE c.type = 'env_personal'::"credential_type"
	AND c.env_owner_user_id IS NOT NULL
ON CONFLICT DO NOTHING;