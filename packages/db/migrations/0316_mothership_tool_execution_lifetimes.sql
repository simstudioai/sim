ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD COLUMN "tool_execution_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD COLUMN "tool_admission_closed_at" timestamp;