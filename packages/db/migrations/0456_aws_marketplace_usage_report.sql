CREATE TYPE "public"."aws_marketplace_usage_report_status" AS ENUM('pending', 'reported', 'rejected');--> statement-breakpoint
CREATE TABLE "aws_marketplace_usage_report" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"license_id" text NOT NULL,
	"dimension" text NOT NULL,
	"hour_start" timestamp NOT NULL,
	"cost_through_usd" numeric NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_through" integer NOT NULL,
	"status" "aws_marketplace_usage_report_status" DEFAULT 'pending' NOT NULL,
	"metering_record_id" text,
	"error" text,
	"reported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aws_marketplace_license" ADD COLUMN "organization_linked_at" timestamp;--> statement-breakpoint
ALTER TABLE "aws_marketplace_usage_report" ADD CONSTRAINT "aws_marketplace_usage_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aws_marketplace_usage_report" ADD CONSTRAINT "aws_marketplace_usage_report_license_id_aws_marketplace_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."aws_marketplace_license"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aws_marketplace_usage_report_org_dimension_hour_unique" ON "aws_marketplace_usage_report" USING btree ("organization_id","dimension","hour_start");--> statement-breakpoint
CREATE INDEX "aws_marketplace_usage_report_status_hour_idx" ON "aws_marketplace_usage_report" USING btree ("status","hour_start");--> statement-breakpoint
CREATE INDEX "aws_marketplace_usage_report_license_id_idx" ON "aws_marketplace_usage_report" USING btree ("license_id");