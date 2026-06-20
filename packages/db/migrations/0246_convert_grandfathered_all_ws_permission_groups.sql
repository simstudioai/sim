-- migration-safe: data-only backfill. Non-default permission groups no longer support an
-- "all workspaces" scope; they must target specific workspaces. This clears the flag on every
-- grandfathered non-default all-workspaces group and, only for those that HAVE members, targets
-- every workspace the org currently has -- so a member-bearing group keeps governing the same
-- members on existing workspaces. A zero-member all-workspaces group governed nobody under the old
-- member-keyed resolver, so it is left with no workspaces (still inert) rather than being turned
-- into an all-members group that would suddenly govern everyone. Workspace rows are inserted before
-- the flag is cleared so the source set still matches; idempotent via ON CONFLICT and the flag
-- predicate, so a replay is a no-op.
INSERT INTO "permission_group_workspace" ("id", "permission_group_id", "workspace_id", "organization_id", "created_at")
SELECT gen_random_uuid()::text, pg."id", w."id", pg."organization_id", now()
FROM "permission_group" pg
JOIN "workspace" w ON w."organization_id" = pg."organization_id"
WHERE pg."is_default" = false AND pg."applies_to_all_workspaces" = true
  AND EXISTS (SELECT 1 FROM "permission_group_member" m WHERE m."permission_group_id" = pg."id")
ON CONFLICT ("permission_group_id", "workspace_id") DO NOTHING;
--> statement-breakpoint
UPDATE "permission_group"
SET "applies_to_all_workspaces" = false, "updated_at" = now()
WHERE "is_default" = false AND "applies_to_all_workspaces" = true;
