ALTER TABLE "subscription" ADD COLUMN "loops_customer_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "loops_subscription_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "loops_customer_id" text;