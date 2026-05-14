CREATE TYPE "public"."billing_claim_status" AS ENUM('claimed', 'invoiced', 'paid', 'failed', 'invoice_failed');--> statement-breakpoint
CREATE TYPE "public"."billing_claim_type" AS ENUM('threshold', 'final');--> statement-breakpoint
CREATE TYPE "public"."billing_entity_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TABLE "billing_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" "billing_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"subscription_id" text,
	"claim_type" "billing_claim_type" NOT NULL,
	"status" "billing_claim_status" DEFAULT 'claimed' NOT NULL,
	"billing_period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp,
	"gross_usage" numeric DEFAULT '0' NOT NULL,
	"daily_refresh_deduction" numeric DEFAULT '0' NOT NULL,
	"prior_covered_overage" numeric DEFAULT '0' NOT NULL,
	"overage_amount" numeric DEFAULT '0' NOT NULL,
	"credit_applied" numeric DEFAULT '0' NOT NULL,
	"amount_to_bill" numeric DEFAULT '0' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_invoice_id" text,
	"outbox_event_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_claim_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"usage_log_id" text NOT NULL,
	"allocated_amount" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "source_event_key" text;--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "source_event_hash" text;--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "billing_entity_type" "billing_entity_type";--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "billing_entity_id" text;--> statement-breakpoint
ALTER TABLE "billing_claim" ADD CONSTRAINT "billing_claim_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_claim" ADD CONSTRAINT "billing_claim_outbox_event_id_outbox_event_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_claim_usage" ADD CONSTRAINT "billing_claim_usage_claim_id_billing_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."billing_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_claim_usage" ADD CONSTRAINT "billing_claim_usage_usage_log_id_usage_log_id_fk" FOREIGN KEY ("usage_log_id") REFERENCES "public"."usage_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_claim_entity_period_idx" ON "billing_claim" USING btree ("entity_type","entity_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "billing_claim_subscription_period_idx" ON "billing_claim" USING btree ("subscription_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "billing_claim_status_idx" ON "billing_claim" USING btree ("status");--> statement-breakpoint
CREATE INDEX "billing_claim_usage_claim_id_idx" ON "billing_claim_usage" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "billing_claim_usage_usage_log_id_idx" ON "billing_claim_usage" USING btree ("usage_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_claim_usage_claim_usage_unique_idx" ON "billing_claim_usage" USING btree ("claim_id","usage_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_log_source_event_key_idx" ON "usage_log" USING btree ("source_event_key") WHERE "usage_log"."source_event_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_log_billing_entity_period_idx" ON "usage_log" USING btree ("billing_entity_type","billing_entity_id","created_at");