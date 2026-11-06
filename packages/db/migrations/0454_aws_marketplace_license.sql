CREATE TYPE "public"."aws_marketplace_license_status" AS ENUM('pending', 'active', 'inactive');--> statement-breakpoint
CREATE TABLE "aws_marketplace_license" (
	"id" text PRIMARY KEY NOT NULL,
	"license_arn" text NOT NULL,
	"product_code" text NOT NULL,
	"customer_aws_account_id" text NOT NULL,
	"agreement_id" text,
	"agreement_seen_at" timestamp,
	"renewed_agreement_id" text,
	"organization_id" text,
	"status" "aws_marketplace_license_status" DEFAULT 'pending' NOT NULL,
	"dimension" text,
	"quantity" integer,
	"expires_at" timestamp,
	"last_verified_at" timestamp NOT NULL,
	"last_verification_attempt_at" timestamp NOT NULL,
	"license_event_received_at" timestamp,
	"claim_token_hash" text,
	"claim_expires_at" timestamp,
	"linked_by_user_id" text,
	"contact_email" text,
	"company_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aws_marketplace_license" ADD CONSTRAINT "aws_marketplace_license_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aws_marketplace_license" ADD CONSTRAINT "aws_marketplace_license_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aws_marketplace_license_arn_unique" ON "aws_marketplace_license" USING btree ("license_arn");--> statement-breakpoint
CREATE UNIQUE INDEX "aws_marketplace_license_claim_token_hash_unique" ON "aws_marketplace_license" USING btree ("claim_token_hash");--> statement-breakpoint
CREATE INDEX "aws_marketplace_license_agreement_id_idx" ON "aws_marketplace_license" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "aws_marketplace_license_renewed_agreement_id_idx" ON "aws_marketplace_license" USING btree ("renewed_agreement_id");--> statement-breakpoint
CREATE INDEX "aws_marketplace_license_account_product_idx" ON "aws_marketplace_license" USING btree ("customer_aws_account_id","product_code");--> statement-breakpoint
CREATE INDEX "aws_marketplace_license_last_attempt_idx" ON "aws_marketplace_license" USING btree ("last_verification_attempt_at");--> statement-breakpoint
CREATE INDEX "aws_marketplace_license_organization_id_idx" ON "aws_marketplace_license" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "aws_marketplace_license_linked_by_user_id_idx" ON "aws_marketplace_license" USING btree ("linked_by_user_id");