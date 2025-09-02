ALTER TABLE "subscription" DROP CONSTRAINT "check_enterprise_metadata";--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "org_usage_limit" IF NOT EXISTS numeric;--> statement-breakpoint
ALTER TABLE "user_stats" ALTER COLUMN "current_usage_limit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN IF NOT EXISTS "billing_blocked" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_stats" DROP COLUMN "usage_limit_set_by";--> statement-breakpoint
ALTER TABLE "user_stats" DROP COLUMN "billing_period_start";--> statement-breakpoint
ALTER TABLE "user_stats" DROP COLUMN "billing_period_end";--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "check_enterprise_metadata" CHECK (plan != 'enterprise' OR metadata IS NOT NULL);