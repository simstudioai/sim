ALTER TABLE "user_stats" ADD COLUMN "total_copilot_cost" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "total_copilot_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "total_copilot_calls" integer DEFAULT 0 NOT NULL;