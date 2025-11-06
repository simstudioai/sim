CREATE TABLE "paused_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"execution_snapshot" jsonb NOT NULL,
	"pause_points" jsonb NOT NULL,
	"total_pause_count" integer NOT NULL,
	"resumed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paused_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "resume_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"paused_execution_id" text NOT NULL,
	"parent_execution_id" text NOT NULL,
	"new_execution_id" text NOT NULL,
	"context_id" text NOT NULL,
	"resume_input" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"claimed_at" timestamp,
	"completed_at" timestamp,
	"failure_reason" text
);
--> statement-breakpoint
ALTER TABLE "custom_tools" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "paused_executions" ADD CONSTRAINT "paused_executions_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_queue" ADD CONSTRAINT "resume_queue_paused_execution_id_paused_executions_id_fk" FOREIGN KEY ("paused_execution_id") REFERENCES "public"."paused_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paused_executions_workflow_id_idx" ON "paused_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "paused_executions_status_idx" ON "paused_executions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "paused_executions_execution_id_unique" ON "paused_executions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "resume_queue_parent_status_idx" ON "resume_queue" USING btree ("parent_execution_id","status","queued_at");--> statement-breakpoint
CREATE INDEX "resume_queue_new_execution_idx" ON "resume_queue" USING btree ("new_execution_id");