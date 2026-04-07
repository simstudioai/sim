CREATE TABLE "job_execution_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text,
	"workspace_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"level" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"total_duration_ms" integer,
	"execution_data" jsonb DEFAULT '{}' NOT NULL,
	"cost" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_execution_logs" ADD CONSTRAINT "job_execution_logs_schedule_id_workflow_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."workflow_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_execution_logs" ADD CONSTRAINT "job_execution_logs_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_execution_logs_schedule_id_idx" ON "job_execution_logs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "job_execution_logs_workspace_started_at_idx" ON "job_execution_logs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_execution_logs_execution_id_unique" ON "job_execution_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "job_execution_logs_trigger_idx" ON "job_execution_logs" USING btree ("trigger");