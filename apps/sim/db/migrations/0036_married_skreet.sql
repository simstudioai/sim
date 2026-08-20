ALTER TABLE "organization" ALTER COLUMN "metadata" SET DATA TYPE json;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "metadata" json;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "total_chat_executions" integer DEFAULT 0 NOT NULL;