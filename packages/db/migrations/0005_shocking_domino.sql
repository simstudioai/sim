CREATE TABLE "workflow_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"cron_expression" text,
	"next_run_at" timestamp,
	"last_ran_at" timestamp,
	"trigger_type" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;