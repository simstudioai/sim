ALTER TABLE "slack_app" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_app" ALTER COLUMN "encrypted_client_secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_app" ALTER COLUMN "encrypted_signing_secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_app" ADD CONSTRAINT "slack_app_custom_credentials_check" CHECK ("slack_app"."kind" = 'shared' OR ("slack_app"."client_id" IS NOT NULL AND "slack_app"."encrypted_client_secret" IS NOT NULL AND "slack_app"."encrypted_signing_secret" IS NOT NULL)) NOT VALID;
