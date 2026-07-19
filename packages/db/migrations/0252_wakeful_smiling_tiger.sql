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
CREATE TABLE "workspace_fork_block_map" (
	"id" text PRIMARY KEY NOT NULL,
	"child_workspace_id" text NOT NULL,
	"parent_workflow_id" text NOT NULL,
	"parent_block_id" text NOT NULL,
	"child_workflow_id" text NOT NULL,
	"child_block_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_fork_dependent_value" (
	"id" text PRIMARY KEY NOT NULL,
	"child_workspace_id" text NOT NULL,
	"target_workflow_id" text NOT NULL,
	"target_block_id" text NOT NULL,
	"sub_block_key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "background_work_status" ADD CONSTRAINT "background_work_status_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_work_status" ADD CONSTRAINT "background_work_status_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_fork_block_map" ADD CONSTRAINT "workspace_fork_block_map_child_workspace_id_workspace_id_fk" FOREIGN KEY ("child_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_fork_dependent_value" ADD CONSTRAINT "workspace_fork_dependent_value_child_workspace_id_workspace_id_fk" FOREIGN KEY ("child_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_work_status_workspace_status_idx" ON "background_work_status" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "background_work_status_workflow_status_idx" ON "background_work_status" USING btree ("workflow_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_fork_block_map_child_ws_parent_unique" ON "workspace_fork_block_map" USING btree ("child_workspace_id","parent_block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_fork_block_map_child_ws_child_unique" ON "workspace_fork_block_map" USING btree ("child_workspace_id","child_block_id");--> statement-breakpoint
CREATE INDEX "workspace_fork_block_map_child_ws_parent_wf_idx" ON "workspace_fork_block_map" USING btree ("child_workspace_id","parent_workflow_id");--> statement-breakpoint
CREATE INDEX "workspace_fork_block_map_child_ws_child_wf_idx" ON "workspace_fork_block_map" USING btree ("child_workspace_id","child_workflow_id");--> statement-breakpoint
CREATE INDEX "workspace_fork_dependent_value_child_ws_wf_idx" ON "workspace_fork_dependent_value" USING btree ("child_workspace_id","target_workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_fork_dependent_value_field_unique" ON "workspace_fork_dependent_value" USING btree ("child_workspace_id","target_workflow_id","target_block_id","sub_block_key");