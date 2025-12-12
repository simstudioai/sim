ALTER TABLE "settings" ADD COLUMN "console_expanded_by_default" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "debug_mode";