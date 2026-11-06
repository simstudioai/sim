CREATE TYPE "public"."aws_marketplace_license_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "aws_marketplace_license" (
	"id" text PRIMARY KEY NOT NULL,
	"license_arn" text NOT NULL,
	"product_code" text NOT NULL,
	"customer_identifier" text NOT NULL,
	"customer_aws_account_id" text,
	"organization_id" text,
	"status" "aws_marketplace_license_status" DEFAULT 'inactive' NOT NULL,
	"dimension" text,
	"quantity" integer,
	"expires_at" timestamp,
	"last_verified_at" timestamp NOT NULL,
	"claim_token_hash" text,
	"claim_expires_at" timestamp,
	"linked_by_user_id" text,
	"linked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aws_marketplace_license" ADD CONSTRAINT "aws_marketplace_license_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aws_marketplace_license" ADD CONSTRAINT "aws_marketplace_license_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aws_marketplace_license_arn_unique" ON "aws_marketplace_license" USING btree ("license_arn");--> statement-breakpoint
CREATE UNIQUE INDEX "aws_marketplace_license_claim_token_hash_unique" ON "aws_marketplace_license" USING btree ("claim_token_hash");--> statement-breakpoint
CREATE INDEX "aws_marketplace_license_last_verified_at_idx" ON "aws_marketplace_license" USING btree ("last_verified_at");--> statement-breakpoint
CREATE INDEX "aws_marketplace_license_organization_id_idx" ON "aws_marketplace_license" USING btree ("organization_id");