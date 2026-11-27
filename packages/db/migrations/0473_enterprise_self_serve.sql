-- Replay-safe: the embedded COMMITs in 0470 and 0472 leave this file in autocommit, and a lock-timeout retry
-- replays every unjournaled file from the top.
CREATE TABLE IF NOT EXISTS "enterprise_seat_true_up" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"peak_extra_seats" integer NOT NULL,
	"seat_price_cents" integer NOT NULL,
	"amount_cents" integer,
	"billed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "self_serve_usage_limit" numeric;--> statement-breakpoint
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_seat_true_up_subscription_id_subscription_id_fk' AND conrelid = 'enterprise_seat_true_up'::regclass) THEN
ALTER TABLE "enterprise_seat_true_up" ADD CONSTRAINT "enterprise_seat_true_up_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;
END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_seat_true_up_organization_id_organization_id_fk' AND conrelid = 'enterprise_seat_true_up'::regclass) THEN
ALTER TABLE "enterprise_seat_true_up" ADD CONSTRAINT "enterprise_seat_true_up_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_seat_true_up_subscription_window_unique" ON "enterprise_seat_true_up" USING btree ("subscription_id","window_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_seat_true_up_organization_id_idx" ON "enterprise_seat_true_up" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_seat_true_up_unbilled_idx" ON "enterprise_seat_true_up" USING btree ("window_end") WHERE billed_at IS NULL;
