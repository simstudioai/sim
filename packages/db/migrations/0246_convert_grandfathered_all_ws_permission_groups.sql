-- migration-safe: data-only backfill. Non-default permission groups no longer support an
-- "all workspaces" scope (they must target specific workspaces), and a non-default group with no
-- members now governs *all* members of its workspaces. The old resolver was member-keyed, so it is
-- preserved under the new workspace-keyed resolver by:
--   1. pinning each member-bearing all-workspaces group to every workspace its org currently has, so
--      it keeps governing the same members on existing workspaces;
--   2. clearing the workspace associations of every zero-member non-default group, so it stays inert
--      -- it governed nobody before and must not flip to governing everyone in its workspaces. This
--      covers both grandfathered all-workspaces groups and pre-existing workspace-specific groups
--      that happen to have no members;
--   3. clearing the all-workspaces flag on all non-default groups (only the default may be org-wide).
-- Idempotent: ON CONFLICT on the insert, the empty-membership predicate on the delete, and the flag
-- predicate on the update all make a replay a no-op.
INSERT INTO "permission_group_workspace" ("id", "permission_group_id", "workspace_id", "organization_id", "created_at")
SELECT gen_random_uuid()::text, pg."id", w."id", pg."organization_id", now()
FROM "permission_group" pg
JOIN "workspace" w ON w."organization_id" = pg."organization_id"
WHERE pg."is_default" = false AND pg."applies_to_all_workspaces" = true
  AND EXISTS (SELECT 1 FROM "permission_group_member" m WHERE m."permission_group_id" = pg."id")
ON CONFLICT ("permission_group_id", "workspace_id") DO NOTHING;
--> statement-breakpoint
DELETE FROM "permission_group_workspace" pgw
USING "permission_group" pg
WHERE pgw."permission_group_id" = pg."id"
  AND pg."is_default" = false
  AND NOT EXISTS (SELECT 1 FROM "permission_group_member" m WHERE m."permission_group_id" = pg."id");
--> statement-breakpoint
UPDATE "permission_group"
SET "applies_to_all_workspaces" = false, "updated_at" = now()
WHERE "is_default" = false AND "applies_to_all_workspaces" = true;
