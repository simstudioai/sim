ALTER TYPE "public"."credential_type" ADD VALUE 'service_account';--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "encrypted_service_account_key" text;