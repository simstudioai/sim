ALTER TABLE "knowledge_connector" ALTER COLUMN "credential_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD COLUMN "encrypted_api_key" text;