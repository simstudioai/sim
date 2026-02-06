ALTER TYPE "public"."usage_log_source" ADD VALUE 'mcp_copilot';--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "total_mcp_copilot_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "total_mcp_copilot_cost" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "current_period_mcp_copilot_cost" numeric DEFAULT '0' NOT NULL;