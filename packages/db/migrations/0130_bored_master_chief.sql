-- Step 1: Add workspace_id as nullable first
ALTER TABLE "memory" ADD COLUMN "workspace_id" text;

-- Step 2: Backfill workspace_id from workflow's workspace_id
UPDATE memory m
SET workspace_id = w.workspace_id
FROM workflow w
WHERE m.workflow_id = w.id
AND w.workspace_id IS NOT NULL;

-- Step 3: Delete rows where workspace_id couldn't be resolved
DELETE FROM memory WHERE workspace_id IS NULL;

-- Step 4: Now make workspace_id NOT NULL
ALTER TABLE "memory" ALTER COLUMN "workspace_id" SET NOT NULL;

-- Step 5: Drop old constraint and indexes
ALTER TABLE "memory" DROP CONSTRAINT IF EXISTS "memory_workflow_id_workflow_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "memory_workflow_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "memory_workflow_key_idx";

-- Step 6: Add new foreign key and indexes
ALTER TABLE "memory" ADD CONSTRAINT "memory_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "memory_workspace_idx" ON "memory" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_workspace_key_idx" ON "memory" USING btree ("workspace_id","key");

-- Step 7: Drop old column
ALTER TABLE "memory" DROP COLUMN IF EXISTS "workflow_id";
