ALTER TABLE "organization" ADD COLUMN "session_policy_settings" json;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "security_policy_version" integer DEFAULT 1 NOT NULL;