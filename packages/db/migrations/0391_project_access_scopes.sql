ALTER TABLE "permission_group" ADD COLUMN "project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE VIEW "public"."permission_group_workspace_scope" AS (
  SELECT g.id, g.permission_group_id, g.workspace_id, g.organization_id, g.created_at
  FROM permission_group_workspace g
  UNION ALL
  SELECT pg.id || ':' || w.id, pg.id, w.id, pg.organization_id, pg.created_at
  FROM permission_group pg
  JOIN project p ON pg.project_ids ? p.id AND p.organization_id = pg.organization_id AND p.archived_at IS NULL
  JOIN project_workspace pw ON pw.project_id = p.id
  JOIN workspace w ON w.id = pw.workspace_id AND w.organization_id = pg.organization_id AND w.archived_at IS NULL
  WHERE pg.is_default = false AND NOT EXISTS (
    SELECT 1 FROM permission_group_workspace direct
    WHERE direct.permission_group_id = pg.id AND direct.workspace_id = w.id
  )
);