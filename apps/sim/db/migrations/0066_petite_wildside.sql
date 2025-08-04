CREATE TABLE "copilot_feedback" (
	"feedback_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_query" text NOT NULL,
	"agent_response" text NOT NULL,
	"is_positive" boolean NOT NULL,
	"feedback" text,
	"workflow_yaml" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_stats" ALTER COLUMN "current_usage_limit" SET DEFAULT '10';--> statement-breakpoint
CREATE INDEX "copilot_feedback_is_positive_idx" ON "copilot_feedback" USING btree ("is_positive");--> statement-breakpoint
CREATE INDEX "copilot_feedback_created_at_idx" ON "copilot_feedback" USING btree ("created_at");