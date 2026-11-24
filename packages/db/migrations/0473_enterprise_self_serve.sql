CREATE TABLE "enterprise_seat_true_up" (
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
ALTER TABLE "organization" ADD COLUMN "self_serve_usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "enterprise_seat_true_up" ADD CONSTRAINT "enterprise_seat_true_up_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_seat_true_up" ADD CONSTRAINT "enterprise_seat_true_up_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_seat_true_up_subscription_window_unique" ON "enterprise_seat_true_up" USING btree ("subscription_id","window_start");--> statement-breakpoint
CREATE INDEX "enterprise_seat_true_up_organization_id_idx" ON "enterprise_seat_true_up" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "enterprise_seat_true_up_unbilled_idx" ON "enterprise_seat_true_up" USING btree ("window_end") WHERE billed_at IS NULL;
