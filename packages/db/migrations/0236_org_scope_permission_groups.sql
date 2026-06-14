-- Rebase permission groups from workspace-scoped to organization-scoped.
-- Hand-edited from the generated migration to preserve existing data: each
-- workspace-scoped permission_group is re-pointed at the organization that owns
-- its workspace, the legacy `auto_add_new_members` flag is carried into the new
-- per-organization `is_default` flag, and per-workspace memberships collapse to
-- "one group per user per organization". The final schema state matches the
-- generated 0236 snapshot.
--
-- Deterministic consolidation rules (ordered by created_at, id):
--   * groups whose workspace has no organization are dropped (org-only feature).
--   * duplicate (organization_id, name) -> oldest keeps its name, later groups
--     are suffixed " (2)", " (3)", ...
--   * multiple default groups per organization -> only the oldest stays default.
--   * duplicate (organization_id, user_id) memberships -> keep the membership in
--     the oldest group, drop the rest.

-- 1. Drop the workspace-scoped foreign keys and unique indexes so the legacy
--    columns can be removed and consolidation can run unconstrained.
ALTER TABLE "permission_group" DROP CONSTRAINT "permission_group_workspace_id_workspace_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_group_member" DROP CONSTRAINT "permission_group_member_workspace_id_workspace_id_fk";
--> statement-breakpoint
DROP INDEX "permission_group_workspace_name_unique";--> statement-breakpoint
DROP INDEX "permission_group_workspace_auto_add_unique";--> statement-breakpoint
DROP INDEX "permission_group_member_workspace_user_unique";--> statement-breakpoint

-- 2. Add the new columns. organization_id starts NULLABLE so existing rows can be
--    backfilled before NOT NULL is enforced (step 6). is_default defaults to
--    false and is backfilled from auto_add_new_members in step 3.
ALTER TABLE "permission_group" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "permission_group" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "permission_group" ADD CONSTRAINT "permission_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD CONSTRAINT "permission_group_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 3. Backfill organization_id from the owning workspace, and carry the legacy
--    auto-add flag into is_default.
UPDATE "permission_group" pg SET "organization_id" = w."organization_id" FROM "workspace" w WHERE pg."workspace_id" = w."id";--> statement-breakpoint
UPDATE "permission_group_member" pgm SET "organization_id" = w."organization_id" FROM "workspace" w WHERE pgm."workspace_id" = w."id";--> statement-breakpoint
UPDATE "permission_group" SET "is_default" = true WHERE "auto_add_new_members" = true;--> statement-breakpoint

-- 4. Drop groups (and their members) whose workspace has no organization. The
--    feature is organization-only; there is nothing to re-scope for null-org
--    (personal / grandfathered) workspaces.
DELETE FROM "permission_group_member" WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "permission_group" WHERE "organization_id" IS NULL;--> statement-breakpoint

-- 5a. Resolve (organization_id, name) collisions: oldest keeps its name, later
--     groups get a numeric suffix.
UPDATE "permission_group" pg
SET "name" = pg."name" || ' (' || ranked.rn || ')'
FROM (
  SELECT "id",
         row_number() OVER (PARTITION BY "organization_id", "name" ORDER BY "created_at", "id") AS rn
  FROM "permission_group"
) ranked
WHERE pg."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint

-- 5b. Collapse multiple default groups per organization down to the oldest one.
UPDATE "permission_group" pg
SET "is_default" = false
FROM (
  SELECT "id",
         row_number() OVER (PARTITION BY "organization_id" ORDER BY "created_at", "id") AS rn
  FROM "permission_group"
  WHERE "is_default" = true
) ranked
WHERE pg."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint

-- 5c. Deduplicate memberships to one group per (organization_id, user_id),
--     keeping the membership in the oldest group.
DELETE FROM "permission_group_member" pgm
USING (
  SELECT m."id",
         row_number() OVER (
           PARTITION BY m."organization_id", m."user_id"
           ORDER BY g."created_at", g."id", m."assigned_at", m."id"
         ) AS rn
  FROM "permission_group_member" m
  JOIN "permission_group" g ON g."id" = m."permission_group_id"
) ranked
WHERE pgm."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint

-- 6. Enforce NOT NULL now that every surviving row has an organization_id.
ALTER TABLE "permission_group" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_group_member" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint

-- 7. Create the organization-scoped indexes (after consolidation so they do not
--    trip on the pre-consolidation duplicates).
CREATE UNIQUE INDEX "permission_group_organization_name_unique" ON "permission_group" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_organization_default_unique" ON "permission_group" USING btree ("organization_id") WHERE is_default = true;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_member_organization_user_unique" ON "permission_group_member" USING btree ("organization_id","user_id");--> statement-breakpoint

-- 8. Drop the legacy workspace-scoped columns (kept until now for the backfill).
ALTER TABLE "permission_group" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "permission_group" DROP COLUMN "auto_add_new_members";--> statement-breakpoint
ALTER TABLE "permission_group_member" DROP COLUMN "workspace_id";
