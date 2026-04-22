-- Rebase permission groups from organization-scoped to workspace-scoped.
-- Each existing org-scoped permission_group is cloned onto every workspace
-- owned by that org; members are copied to each clone only if the user has
-- workspace-level permissions on the target workspace. The
-- permission_group_member table also gains a denormalized workspace_id column
-- so the database can enforce the "one group per user per workspace"
-- invariant with a composite unique index.

-- 0. Backfill workspace -> organization links for grandfathered workspaces whose
--    billed account user is the sole owner of exactly one organization. This is a
--    best-effort reconciliation: migration 0192 defaulted every pre-existing
--    workspace to `grandfathered_shared` with `organization_id = NULL`, but many
--    of those workspaces belong to users who own a single org. Without this link,
--    the permission-group clone step below would drop all access control data for
--    those workspaces. We only attach when ownership is unambiguous (user owns
--    exactly one org) to avoid silently binding a workspace to the wrong org.
UPDATE "workspace" w
SET "organization_id" = owner_orgs."organization_id",
    "workspace_mode" = 'organization'::"workspace_mode"
FROM (
  SELECT m."user_id", MIN(m."organization_id") AS "organization_id"
  FROM "member" m
  WHERE m."role" = 'owner'
  GROUP BY m."user_id"
  HAVING COUNT(*) = 1
) AS owner_orgs
WHERE w."organization_id" IS NULL
  AND w."workspace_mode" = 'grandfathered_shared'
  AND w."billed_account_user_id" = owner_orgs."user_id";--> statement-breakpoint

-- 1. Add workspace_id columns as nullable so existing rows can coexist during the data migration.
ALTER TABLE "permission_group" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "permission_group" ADD CONSTRAINT "permission_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD CONSTRAINT "permission_group_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 2. Materialize a plan of (source permission group, target workspace, new clone id)
--    so we can insert the clone rows AND the member rows with stable references.
CREATE TEMP TABLE "__permission_group_clone_plan" (
  "source_id" text NOT NULL,
  "cloned_id" text NOT NULL,
  "workspace_id" text NOT NULL
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "__permission_group_clone_plan" ("source_id", "cloned_id", "workspace_id")
SELECT pg."id", gen_random_uuid()::text, w."id"
FROM "permission_group" pg
JOIN "workspace" w ON w."organization_id" = pg."organization_id"
WHERE pg."organization_id" IS NOT NULL;--> statement-breakpoint

-- 3. Create the workspace-scoped clone rows using the planned ids.
INSERT INTO "permission_group" (
  "id",
  "workspace_id",
  "organization_id",
  "name",
  "description",
  "config",
  "created_by",
  "created_at",
  "updated_at",
  "auto_add_new_members"
)
SELECT
  plan."cloned_id",
  plan."workspace_id",
  NULL,
  pg."name",
  pg."description",
  (pg."config" - 'hideEnvironmentTab' - 'hideTemplates'),
  pg."created_by",
  now(),
  now(),
  pg."auto_add_new_members"
FROM "__permission_group_clone_plan" plan
JOIN "permission_group" pg ON pg."id" = plan."source_id";--> statement-breakpoint

-- 4. Copy member rows to each workspace clone, populating the denormalized
--    workspace_id. Only include users who have workspace-level permissions on
--    that target workspace, OR who are the workspace owner (legacy workspaces
--    may have an owner without an explicit permissions row).
INSERT INTO "permission_group_member" ("id", "permission_group_id", "workspace_id", "user_id", "assigned_by", "assigned_at")
SELECT
  gen_random_uuid()::text,
  plan."cloned_id",
  plan."workspace_id",
  m."user_id",
  m."assigned_by",
  m."assigned_at"
FROM "__permission_group_clone_plan" plan
JOIN "permission_group_member" m ON m."permission_group_id" = plan."source_id"
WHERE EXISTS (
  SELECT 1 FROM "permissions" p
  WHERE p."entity_type" = 'workspace'
    AND p."entity_id" = plan."workspace_id"
    AND p."user_id" = m."user_id"
) OR EXISTS (
  SELECT 1 FROM "workspace" w
  WHERE w."id" = plan."workspace_id"
    AND w."owner_id" = m."user_id"
);--> statement-breakpoint

-- 5. Delete legacy org-scoped rows now that clones exist.
DELETE FROM "permission_group_member"
WHERE "permission_group_id" IN (
  SELECT "id" FROM "permission_group" WHERE "organization_id" IS NOT NULL
);--> statement-breakpoint

DELETE FROM "permission_group" WHERE "organization_id" IS NOT NULL;--> statement-breakpoint

-- 6. Enforce NOT NULL on both workspace_id columns now that every surviving row has one.
ALTER TABLE "permission_group" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_group_member" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint

-- 7. Drop legacy structures and swap indexes.
ALTER TABLE "permission_group" DROP CONSTRAINT "permission_group_organization_id_organization_id_fk";--> statement-breakpoint
DROP INDEX "permission_group_org_name_unique";--> statement-breakpoint
DROP INDEX "permission_group_org_auto_add_unique";--> statement-breakpoint
DROP INDEX "permission_group_member_user_id_unique";--> statement-breakpoint
ALTER TABLE "permission_group" DROP COLUMN "organization_id";--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_workspace_name_unique" ON "permission_group" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_workspace_auto_add_unique" ON "permission_group" USING btree ("workspace_id") WHERE auto_add_new_members = true;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_member_group_user_unique" ON "permission_group_member" USING btree ("permission_group_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_member_workspace_user_unique" ON "permission_group_member" USING btree ("workspace_id","user_id");--> statement-breakpoint

-- 8. Sweep any residual dead config keys from pre-existing workspace-scoped rows (if any).
UPDATE "permission_group" SET "config" = ("config" - 'hideEnvironmentTab' - 'hideTemplates') WHERE "config" ? 'hideEnvironmentTab' OR "config" ? 'hideTemplates';

