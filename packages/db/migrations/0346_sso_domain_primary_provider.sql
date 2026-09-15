-- An organization may keep several identity providers on one domain while it moves from one
-- identity provider to another. The verified domain names which of them sign-in uses; null keeps
-- today's rule, the first verified provider by id. Nullable with no default, so existing rows and
-- the previous release are unaffected.
ALTER TABLE "sso_domain" ADD COLUMN IF NOT EXISTS "primary_provider_id" text;--> statement-breakpoint

COMMIT;--> statement-breakpoint

-- `lock_timeout = 0` for the concurrent drop, per packages/db/scripts/migrate.ts.
SET lock_timeout = 0;--> statement-breakpoint

-- migration-safe: this index refused a second provider on an organization domain, which is exactly what this release allows. The previous release refuses a same-domain provider in its registration route before writing, so dropping the index changes nothing while it still serves traffic.
DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_org_domain_unique";--> statement-breakpoint

SET lock_timeout = '5s';
