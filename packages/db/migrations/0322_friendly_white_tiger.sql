ALTER TABLE "account" ADD COLUMN "oauth_config" text;--> statement-breakpoint
ALTER TABLE "pending_credential_draft" ADD COLUMN "oauth_config" text;