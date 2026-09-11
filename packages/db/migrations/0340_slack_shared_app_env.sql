ALTER TABLE "slack_app" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_app" ALTER COLUMN "encrypted_client_secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_app" ALTER COLUMN "encrypted_signing_secret" DROP NOT NULL;