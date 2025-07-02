CREATE TABLE "workflow_execution_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"state_snapshot_id" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"total_duration_ms" integer,
	"block_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric(10, 6),
	"total_input_cost" numeric(10, 6),
	"total_output_cost" numeric(10, 6),
	"total_tokens" integer,
	"primary_model" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_state_snapshot_id_workflow_execution_snapshots_id_fk" FOREIGN KEY ("state_snapshot_id") REFERENCES "public"."workflow_execution_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workflow_id_idx" ON "workflow_execution_logs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_execution_id_idx" ON "workflow_execution_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_trigger_idx" ON "workflow_execution_logs" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_level_idx" ON "workflow_execution_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_started_at_idx" ON "workflow_execution_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_cost_idx" ON "workflow_execution_logs" USING btree ("total_cost");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_duration_idx" ON "workflow_execution_logs" USING btree ("total_duration_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_execution_logs_execution_id_unique" ON "workflow_execution_logs" USING btree ("execution_id");