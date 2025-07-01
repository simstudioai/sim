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
CREATE TABLE "workflow_execution_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"state_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_execution_blocks" ADD CONSTRAINT "workflow_execution_blocks_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "workflow_snapshots_workflow_id_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_hash_idx" ON "workflow_execution_snapshots" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_snapshots_workflow_hash_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id","state_hash");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_created_at_idx" ON "workflow_execution_snapshots" USING btree ("created_at");