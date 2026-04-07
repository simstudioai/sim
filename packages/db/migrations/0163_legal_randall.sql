ALTER TABLE "workflow_schedule" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "source_type" text DEFAULT 'workflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "lifecycle" text DEFAULT 'persistent' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "success_condition" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "max_runs" integer;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "run_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "source_chat_id" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "source_task_name" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "source_user_id" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "source_workspace_id" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_source_user_id_user_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_source_workspace_id_workspace_id_fk" FOREIGN KEY ("source_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;