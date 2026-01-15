ALTER TABLE "settings" ALTER COLUMN "theme" SET DEFAULT 'dark';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "show_action_bar" boolean DEFAULT true NOT NULL;