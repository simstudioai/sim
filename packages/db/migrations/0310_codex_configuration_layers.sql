ALTER TABLE "workflow" ADD COLUMN "codex_config" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "codex_config" jsonb DEFAULT '{}' NOT NULL;