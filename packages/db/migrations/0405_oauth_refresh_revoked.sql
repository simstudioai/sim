ALTER TABLE "account" ADD COLUMN "refresh_revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "refresh_revoked_code" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "refresh_revoked_token_hash" text;