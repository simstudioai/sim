CREATE TYPE "public"."billing_entity_type" AS ENUM('user', 'organization');--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "billing_entity_type" "billing_entity_type";--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "billing_entity_id" text;--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "billing_period_start" timestamp;--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "billing_period_end" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_log_event_key_unique" ON "usage_log" USING btree ("event_key") WHERE "usage_log"."event_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_log_billing_entity_period_idx" ON "usage_log" USING btree ("billing_entity_type","billing_entity_id","billing_period_start","billing_period_end") WHERE "usage_log"."billing_entity_type" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_billing_scope_all_or_none" CHECK ((
        ("usage_log"."billing_entity_type" IS NULL AND "usage_log"."billing_entity_id" IS NULL AND "usage_log"."billing_period_start" IS NULL AND "usage_log"."billing_period_end" IS NULL)
        OR
        ("usage_log"."billing_entity_type" IS NOT NULL AND "usage_log"."billing_entity_id" IS NOT NULL AND "usage_log"."billing_period_start" IS NOT NULL AND "usage_log"."billing_period_end" IS NOT NULL AND "usage_log"."billing_period_start" < "usage_log"."billing_period_end")
      )) NOT VALID;