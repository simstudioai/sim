CREATE TABLE "sso_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sso_domain" ADD CONSTRAINT "sso_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_domain" ADD CONSTRAINT "sso_domain_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sso_domain_organization_id_idx" ON "sso_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sso_domain_domain_idx" ON "sso_domain" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_domain_org_domain_unique" ON "sso_domain" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_domain_verified_unique" ON "sso_domain" USING btree ("domain") WHERE status = 'verified';--> statement-breakpoint
-- Grandfather existing org-scoped SSO provider domains as verified: they were
-- claimed under the old first-come model, so treat them as owned/verified to
-- avoid breaking live SSO. The normalized value must match normalizeSSODomain
-- (the runtime gate's canonicalizer) so grandfathered lookups hit — hence
-- lower + trim + strip a leading wildcard label; other artifacts (protocol,
-- port, path) never occur in stored SSO domains. Computing it in a subquery
-- keeps the DISTINCT ON dedup key identical to the inserted value, so the
-- global partial unique index on verified rows can never be violated. The
-- token is a placeholder since these rows are already verified.
-- NOTE: if two orgs somehow share a domain (possible only for data predating the
-- register-route conflict check), DISTINCT ON grandfathers the lowest org_id and
-- the other org gets no row. Its existing SSO login is unaffected (login never
-- reads sso_domain); it just can't re-register that domain until an admin
-- resolves the duplicate. Validated against prod: no such duplicates exist.
INSERT INTO "sso_domain" ("id", "organization_id", "domain", "status", "verification_token", "verified_at", "created_at", "updated_at")
SELECT DISTINCT ON ("norm_domain")
	gen_random_uuid()::text,
	"organization_id",
	"norm_domain",
	'verified',
	gen_random_uuid()::text,
	now(),
	now(),
	now()
FROM (
	SELECT "organization_id", lower(regexp_replace(btrim("domain"), '^\*\.', '')) AS "norm_domain"
	FROM "sso_provider"
	WHERE "organization_id" IS NOT NULL
) AS "normalized"
ORDER BY "norm_domain", "organization_id";