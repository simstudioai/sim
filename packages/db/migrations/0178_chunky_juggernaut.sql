-- Dedupe block prepended after `bun run db:generate` so the unique index can apply (0172 workflow pattern).
--
-- Deduplicate knowledge base names within each workspace before adding the unique index.
-- Keeps the most recently updated row with its original name; older duplicates get " (2)", " (3)", etc.
-- Only rows with a workspace_id are partitioned (PG treats NULL workspace_id as distinct in unique indexes).
WITH duplicates AS (
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
SET name = knowledge_base.name || ' (' || duplicates.rn || ')'
FROM duplicates
WHERE knowledge_base.id = duplicates.id
  AND duplicates.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_workspace_name_active_unique" ON "knowledge_base" USING btree ("workspace_id","name") WHERE "knowledge_base"."deleted_at" IS NULL;--> statement-breakpoint
