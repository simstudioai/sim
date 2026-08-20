ALTER TABLE "webhook" ADD COLUMN "provider_config" json;--> statement-breakpoint
ALTER TABLE "webhook" DROP COLUMN "secret";