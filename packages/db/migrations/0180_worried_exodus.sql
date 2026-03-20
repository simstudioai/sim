-- Dedupe blocks prepended after `bunx drizzle-kit generate` so partial unique indexes can apply.
--
-- Knowledge bases: one active name per workspace (see schema `kb_workspace_name_active_unique`).
-- Keeps the most recently updated row with its original name; older duplicates get " (2)", " (3)", etc.
WITH kb_duplicates AS (
  SELECT id, name, workspace_id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, name
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
  FROM knowledge_base
  WHERE deleted_at IS NULL
    AND workspace_id IS NOT NULL
)
UPDATE knowledge_base
SET name = knowledge_base.name || ' (' || kb_duplicates.rn || ')'
FROM kb_duplicates
WHERE knowledge_base.id = kb_duplicates.id
  AND kb_duplicates.rn > 1;--> statement-breakpoint
--
-- Workspace files: one active display name per workspace for context `workspace`
-- (`workspace_files_workspace_name_active_unique`). Keeps the most recently uploaded row; others
-- get " (2)", " (3)", etc.
WITH file_name_duplicates AS (
  SELECT id, original_name, workspace_id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, original_name
      ORDER BY uploaded_at DESC
    ) AS rn
  FROM workspace_files
  WHERE deleted_at IS NULL
    AND context = 'workspace'
    AND workspace_id IS NOT NULL
)
UPDATE workspace_files
SET original_name = workspace_files.original_name || ' (' || file_name_duplicates.rn || ')'
FROM file_name_duplicates
WHERE workspace_files.id = file_name_duplicates.id
  AND file_name_duplicates.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_workspace_name_active_unique" ON "knowledge_base" USING btree ("workspace_id","name") WHERE "knowledge_base"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_files_workspace_name_active_unique" ON "workspace_files" USING btree ("workspace_id","original_name") WHERE "workspace_files"."deleted_at" IS NULL AND "workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL;--> statement-breakpoint
