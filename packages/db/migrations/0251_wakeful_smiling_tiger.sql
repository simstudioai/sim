CREATE TYPE "public"."background_work_kind" AS ENUM('deployment_side_effects', 'fork_content_copy', 'fork_sync', 'fork_rollback');--> statement-breakpoint
CREATE TYPE "public"."background_work_status_value" AS ENUM('pending', 'processing', 'completed', 'completed_with_warnings', 'failed');--> statement-breakpoint
CREATE TABLE "background_work_status" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text,
	"kind" "background_work_kind" NOT NULL,
	"status" "background_work_status_value" NOT NULL,
	"message" text,
	"error" text,
	"metadata" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "background_work_status" ADD CONSTRAINT "background_work_status_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_work_status" ADD CONSTRAINT "background_work_status_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_work_status_workspace_status_idx" ON "background_work_status" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "background_work_status_workflow_status_idx" ON "background_work_status" USING btree ("workflow_id","status");