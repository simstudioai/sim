CREATE TABLE IF NOT EXISTS "usage_daily_cost" (
	"billing_entity_type" "billing_entity_type" NOT NULL,
	"billing_entity_id" text NOT NULL,
	"billing_period_start" timestamp NOT NULL,
	"billing_period_end" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"source" "usage_log_source" NOT NULL,
	"usage_date" date NOT NULL,
	"shard" smallint NOT NULL,
	"cost" numeric NOT NULL,
	"entry_count" bigint NOT NULL,
	CONSTRAINT "usage_daily_cost_pk" PRIMARY KEY("billing_entity_type","billing_entity_id","billing_period_start","billing_period_end","user_id","source","usage_date","shard"),
	CONSTRAINT "usage_daily_cost_shard_bounds" CHECK ("usage_daily_cost"."shard" BETWEEN 0 AND 7)
);
--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN IF NOT EXISTS "cost_projected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_daily_cost_entity_date_idx" ON "usage_daily_cost" USING btree ("billing_entity_type","billing_entity_id","usage_date");
-- The script migration installs synchronous ledger triggers before its batched backfill.
-- It builds embedding_search_document_lookup_idx concurrently and repairs interrupted builds.
