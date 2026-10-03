-- migration-safe: additive columns use non-null defaults, so old and new app versions can read and write these rows throughout the deploy.
ALTER TABLE "workflow_schedule" ADD COLUMN "secret_scope" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "mounted_secrets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "inbox_secret_scope" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "inbox_mounted_secrets" jsonb DEFAULT '[]'::jsonb NOT NULL;
