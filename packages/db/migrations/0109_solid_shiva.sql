CREATE TYPE "public"."workflow_execution_state_status" AS ENUM('success', 'failed', 'paused');--> statement-breakpoint
CREATE TABLE "workflow_execution_states" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"trigger_block_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"run_version" text,
	"serialized_state" jsonb NOT NULL,
	"resolved_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "workflow_execution_state_status" DEFAULT 'success' NOT NULL,
	"attempt_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_execution_states" ADD CONSTRAINT "workflow_execution_states_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_states" ADD CONSTRAINT "workflow_execution_states_trigger_block_id_workflow_blocks_id_fk" FOREIGN KEY ("trigger_block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_execution_states_workflow_trigger_unique" ON "workflow_execution_states" USING btree ("workflow_id","trigger_block_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_states_workflow_idx" ON "workflow_execution_states" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_states_trigger_idx" ON "workflow_execution_states" USING btree ("trigger_block_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_states_execution_idx" ON "workflow_execution_states" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_states_status_idx" ON "workflow_execution_states" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_execution_states_attempt_at_idx" ON "workflow_execution_states" USING btree ("attempt_at");