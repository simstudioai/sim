ALTER TABLE "jwks" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "cancel_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "canceled_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "stripe_schedule_id" text;
