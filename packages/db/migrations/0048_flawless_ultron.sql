ALTER TABLE "user_stats" ADD COLUMN "current_usage_limit" numeric DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "usage_limit_set_by" text;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "usage_limit_updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "current_period_cost" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "billing_period_start" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "billing_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "last_period_cost" numeric DEFAULT '0';--> statement-breakpoint
CREATE INDEX "subscription_reference_status_idx" ON "subscription" USING btree ("reference_id","status");--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "check_enterprise_metadata" CHECK (plan != 'enterprise' OR (metadata IS NOT NULL AND (metadata->>'perSeatAllowance' IS NOT NULL OR metadata->>'totalAllowance' IS NOT NULL)));