ALTER TABLE "settings" ADD COLUMN "error_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "auto_fill_env_vars";