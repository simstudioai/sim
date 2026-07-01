ALTER TABLE "webhook" ALTER COLUMN "path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "routing_key" text;--> statement-breakpoint
CREATE INDEX "webhook_routing_key_active_idx" ON "webhook" USING btree ("routing_key","provider") WHERE "webhook"."archived_at" IS NULL AND "webhook"."routing_key" IS NOT NULL;