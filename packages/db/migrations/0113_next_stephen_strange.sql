ALTER TABLE "organization" ADD COLUMN "prepaid_credits_balance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "prepaid_credits_total_purchased" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "prepaid_credits_total_used" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "prepaid_credits_last_purchase_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "credit_depletion_behavior" text DEFAULT 'fallback_to_overage' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "billing_blocked_reason" text;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "prepaid_credits_balance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "prepaid_credits_total_purchased" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "prepaid_credits_total_used" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "prepaid_credits_last_purchase_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "credit_depletion_behavior" text DEFAULT 'fallback_to_overage' NOT NULL;