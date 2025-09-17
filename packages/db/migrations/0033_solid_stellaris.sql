ALTER TABLE "settings" ALTER COLUMN "general" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "debug_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "auto_connect" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "auto_fill_env_vars" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "telemetry_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "telemetry_notified_user" boolean DEFAULT false NOT NULL;