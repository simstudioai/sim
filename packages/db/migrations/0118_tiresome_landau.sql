CREATE TYPE "public"."billing_blocked_reason" AS ENUM('payment_failed', 'dispute');--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "credit_balance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "credit_balance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "billing_blocked_reason" "billing_blocked_reason";