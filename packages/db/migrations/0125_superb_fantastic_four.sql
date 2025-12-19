-- Step 1: Add column as NULLABLE first (instant, no lock)
ALTER TABLE "workflow_execution_logs" ADD COLUMN "workspace_id" text;--> statement-breakpoint

-- Step 2: Backfill workspace_id from workflow table
UPDATE "workflow_execution_logs" wel
SET "workspace_id" = w."workspace_id"
FROM "workflow" w
WHERE wel."workflow_id" = w."id"
  AND w."workspace_id" IS NOT NULL;--> statement-breakpoint

-- Step 3: Delete orphaned execution logs (from workflows without workspaces)
DELETE FROM "workflow_execution_logs"
WHERE "workspace_id" IS NULL;--> statement-breakpoint

-- Step 4: Add NOT NULL constraint (safe now - all remaining rows have values)
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint

-- Step 5: Add foreign key constraint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Step 6: Create indexes
CREATE INDEX "workflow_execution_logs_workspace_started_at_idx" ON "workflow_execution_logs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "api_key_workspace_type_idx" ON "api_key" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "api_key_user_type_idx" ON "api_key" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workflow_blocks_type_idx" ON "workflow_blocks" USING btree ("type");
