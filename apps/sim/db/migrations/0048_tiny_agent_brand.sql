CREATE TABLE "workflow_execution_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"block_id" text NOT NULL,
	"block_name" text,
	"block_type" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"duration_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"error_stack_trace" text,
	"input_data" jsonb,
	"output_data" jsonb,
	"cost_input" numeric(10, 6),
	"cost_output" numeric(10, 6),
	"cost_total" numeric(10, 6),
	"tokens_prompt" integer,
	"tokens_completion" integer,
	"tokens_total" integer,
	"model_used" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"state_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_execution_blocks" ADD CONSTRAINT "workflow_execution_blocks_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_state_snapshot_id_workflow_execution_snapshots_id_fk" FOREIGN KEY ("state_snapshot_id") REFERENCES "public"."workflow_execution_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ADD CONSTRAINT "workflow_execution_snapshots_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_blocks_execution_id_idx" ON "workflow_execution_blocks" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_workflow_id_idx" ON "workflow_execution_blocks" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_block_id_idx" ON "workflow_execution_blocks" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_status_idx" ON "workflow_execution_blocks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "execution_blocks_duration_idx" ON "workflow_execution_blocks" USING btree ("duration_ms");--> statement-breakpoint
CREATE INDEX "execution_blocks_cost_idx" ON "workflow_execution_blocks" USING btree ("cost_total");--> statement-breakpoint
CREATE INDEX "execution_blocks_workflow_execution_idx" ON "workflow_execution_blocks" USING btree ("workflow_id","execution_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_execution_status_idx" ON "workflow_execution_blocks" USING btree ("execution_id","status");--> statement-breakpoint
CREATE INDEX "execution_blocks_started_at_idx" ON "workflow_execution_blocks" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workflow_id_idx" ON "workflow_execution_logs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_execution_id_idx" ON "workflow_execution_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_trigger_idx" ON "workflow_execution_logs" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_level_idx" ON "workflow_execution_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_started_at_idx" ON "workflow_execution_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_cost_idx" ON "workflow_execution_logs" USING btree ("total_cost");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_duration_idx" ON "workflow_execution_logs" USING btree ("total_duration_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_execution_logs_execution_id_unique" ON "workflow_execution_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_workflow_id_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_hash_idx" ON "workflow_execution_snapshots" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_snapshots_workflow_hash_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id","state_hash");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_created_at_idx" ON "workflow_execution_snapshots" USING btree ("created_at");