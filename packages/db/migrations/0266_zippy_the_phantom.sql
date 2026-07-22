DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "sso_provider"
		WHERE length("provider_id") > 44
			OR "provider_id" !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'
	) THEN
		RAISE EXCEPTION 'SSO migration blocked: provider IDs must be lowercase DNS labels no longer than 44 characters';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "sso_provider"
		WHERE "provider_id" IN ('google', 'github', 'email-password')
	) THEN
		RAISE EXCEPTION 'SSO migration blocked: provider IDs reserved by built-in authentication providers require manual remediation';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "sso_provider"
		WHERE "domain" <> lower(btrim("domain"))
			OR "domain" LIKE '%,%'
			OR "domain" !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$'
	) THEN
		RAISE EXCEPTION 'SSO migration blocked: domains must be one normalized registrable hostname; audit public-suffix ownership before rollout';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "sso_provider"
		WHERE "organization_id" IS NULL
	) THEN
		RAISE EXCEPTION 'SSO migration blocked: user-scoped providers must be assigned to an audited organization or removed';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "sso_provider"
		GROUP BY "provider_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'SSO migration blocked: duplicate provider IDs require manual remediation';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "sso_provider"
		GROUP BY lower("domain")
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'SSO migration blocked: case-insensitive duplicate domains require manual remediation';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "sso_provider"
		GROUP BY "organization_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'SSO migration blocked: organizations with multiple providers require manual remediation';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN IF NOT EXISTS "domain_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_provider_id_format_check" CHECK (length("provider_id") <= 44 AND "provider_id" ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_provider_id_not_reserved_check" CHECK ("provider_id" NOT IN ('google', 'github', 'email-password')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_domain_format_check" CHECK ("domain" = lower(btrim("domain")) AND "domain" NOT LIKE '%,%' AND "domain" ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_required_check" CHECK ("organization_id" IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "sso_provider" VALIDATE CONSTRAINT "sso_provider_provider_id_format_check";--> statement-breakpoint
ALTER TABLE "sso_provider" VALIDATE CONSTRAINT "sso_provider_provider_id_not_reserved_check";--> statement-breakpoint
ALTER TABLE "sso_provider" VALIDATE CONSTRAINT "sso_provider_domain_format_check";--> statement-breakpoint
ALTER TABLE "sso_provider" VALIDATE CONSTRAINT "sso_provider_organization_required_check";--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_provider_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sso_provider_provider_id_unique" ON "sso_provider" USING btree ("provider_id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_domain_lower_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sso_provider_domain_lower_unique" ON "sso_provider" USING btree (lower("domain"));--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_organization_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sso_provider_organization_id_unique" ON "sso_provider" USING btree ("organization_id") WHERE "organization_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_provider_id_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_domain_idx";--> statement-breakpoint
SET lock_timeout = '5s';