CREATE TABLE IF NOT EXISTS "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"domain" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"organization_id" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sso_provider_provider_id_idx" ON "sso_provider" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sso_provider_domain_idx" ON "sso_provider" USING btree ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sso_provider_user_id_idx" ON "sso_provider" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sso_provider_organization_id_idx" ON "sso_provider" USING btree ("organization_id");