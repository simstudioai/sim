ALTER TABLE "settings" ADD COLUMN "billing_usage_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "general";