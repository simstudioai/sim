CREATE TABLE "usage_log_daily_total" (
	"billing_entity_type" "billing_entity_type" NOT NULL,
	"billing_entity_id" text NOT NULL,
	"billing_period_start" timestamp NOT NULL,
	"billing_period_end" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"day_index" integer NOT NULL,
	"source" "usage_log_source" NOT NULL,
	"total_cost" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "usage_log_daily_total_billing_entity_type_billing_entity_id_billing_period_start_billing_period_end_user_id_day_index_source_pk" PRIMARY KEY("billing_entity_type","billing_entity_id","billing_period_start","billing_period_end","user_id","day_index","source")
);
