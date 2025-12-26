ALTER TABLE "workflow_execution_logs" ADD COLUMN "status" text DEFAULT 'running' NOT NULL;--> statement-breakpoint
UPDATE "workflow_execution_logs" 
SET "status" = CASE 
  WHEN "level" = 'error' THEN 'failed'
  WHEN "ended_at" IS NOT NULL THEN 'completed'
  ELSE 'running'
END;