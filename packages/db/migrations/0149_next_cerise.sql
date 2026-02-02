ALTER TABLE "workflow_execution_logs" DROP CONSTRAINT "workflow_execution_logs_workflow_id_workflow_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" DROP CONSTRAINT "workflow_execution_snapshots_workflow_id_workflow_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ADD CONSTRAINT "workflow_execution_snapshots_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;