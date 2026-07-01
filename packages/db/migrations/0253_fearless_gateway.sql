ALTER TABLE "webhook" ALTER COLUMN "path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "routing_key" text;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_routing_key_active_idx" ON "webhook" USING btree ("routing_key","provider") WHERE "webhook"."archived_at" IS NULL AND "webhook"."routing_key" IS NOT NULL;