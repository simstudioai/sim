ALTER TYPE "public"."credential_type" ADD VALUE 'service_account';--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "encrypted_service_account_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workspace_service_account_unique" ON "credential" USING btree ("workspace_id","type","provider_id","display_name") WHERE type = 'service_account';--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_service_account_source_check" CHECK ((type <> 'service_account') OR (encrypted_service_account_key IS NOT NULL AND provider_id IS NOT NULL));