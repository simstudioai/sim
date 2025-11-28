-- Step 1: Convert non-UUID IDs to UUIDs (preserve existing UUIDs)
-- This allows same title in different workspaces by removing function-name-based IDs
UPDATE "custom_tools"
SET "id" = gen_random_uuid()::text
WHERE workspace_id IS NOT NULL  -- Only update workspace-scoped tools
  AND "id" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';  -- Skip if already UUID

-- Step 2: Add composite unique constraint on (workspace_id, title)
-- This enforces uniqueness per workspace, not globally
CREATE UNIQUE INDEX "custom_tools_workspace_title_unique" ON "custom_tools" USING btree ("workspace_id","title");
