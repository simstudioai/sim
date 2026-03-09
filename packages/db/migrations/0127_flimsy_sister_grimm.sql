-- Step 1: Add column as NULLABLE first (instant, no lock)
ALTER TABLE "workflow_execution_logs" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint

-- Step 2: Backfill workspace_id from workflow table
UPDATE "workflow_execution_logs" wel
SET "workspace_id" = w."workspace_id"
FROM "workflow" w
WHERE wel."workflow_id" = w."id"
  AND w."workspace_id" IS NOT NULL
  AND wel."workspace_id" IS NULL;--> statement-breakpoint

-- Step 3: Delete orphaned execution logs (from workflows without workspaces)
DELETE FROM "workflow_execution_logs"
WHERE "workspace_id" IS NULL;--> statement-breakpoint

-- Step 4: Add NOT NULL constraint (safe now - all remaining rows have values)
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint

-- Step 5: Add foreign key constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_execution_logs_workspace_id_workspace_id_fk'
  ) THEN
    ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workspace_id_workspace_id_fk" 
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- Step 6: Create indexes
CREATE INDEX IF NOT EXISTS "workflow_execution_logs_workspace_started_at_idx" ON "workflow_execution_logs" USING btree ("workspace_id","started_at");