CREATE TABLE "referral_attribution" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"campaign_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"referrer_url" text,
	"landing_page" text,
	"bonus_credit_amount" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referral_attribution_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "referral_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"bonus_credit_amount" numeric NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referral_campaigns_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "referral_attribution" ADD CONSTRAINT "referral_attribution_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_attribution" ADD CONSTRAINT "referral_attribution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_attribution" ADD CONSTRAINT "referral_attribution_campaign_id_referral_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."referral_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_attribution_user_id_idx" ON "referral_attribution" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_attribution_org_unique_idx" ON "referral_attribution" USING btree ("organization_id") WHERE "referral_attribution"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "referral_attribution_campaign_id_idx" ON "referral_attribution" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "referral_attribution_utm_campaign_idx" ON "referral_attribution" USING btree ("utm_campaign");--> statement-breakpoint
CREATE INDEX "referral_attribution_utm_content_idx" ON "referral_attribution" USING btree ("utm_content");--> statement-breakpoint
CREATE INDEX "referral_attribution_created_at_idx" ON "referral_attribution" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "referral_campaigns_active_idx" ON "referral_campaigns" USING btree ("is_active");