-- Better Auth declares `provider_id` unique and resolves providers by that column alone, but Sim's
-- table only had a plain index — a double-submit of the SSO form could create two rows sharing one.
-- Enforce the invariant the library already assumes.
--
-- Duplicates must be resolved first. Failing here, inside the transaction, avoids letting the
-- CONCURRENT build fail afterwards and strand an INVALID index that IF NOT EXISTS would skip
-- forever. Which row survives is a judgement call, so this reports the ids and stops.
DO $$
DECLARE duplicate_provider_ids text;
BEGIN
  SELECT string_agg(provider_id, ', ')
    INTO duplicate_provider_ids
    FROM (
      SELECT "provider_id" FROM "sso_provider" GROUP BY "provider_id" HAVING count(*) > 1
    ) AS d;
  IF duplicate_provider_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'sso_provider has duplicate provider_id values: %. Keep one row per provider_id (they are interchangeable when every other column matches — nothing references sso_provider.id) and re-run.',
      duplicate_provider_ids;
  END IF;
END $$;--> statement-breakpoint

-- Mirrors Better Auth's SSO `domainVerification` flag. DEFAULT true is deliberate: that option
-- turns sign-in into a hard gate rejecting any provider without the flag, so rows predating this
-- column must satisfy it or existing tenants are locked out the moment the app rolls. Sim already
-- gates registration on its own DNS proof, so "verified" is truthful for every existing provider.
ALTER TABLE "sso_provider" ADD COLUMN IF NOT EXISTS "domain_verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint

COMMIT;--> statement-breakpoint

-- `lock_timeout = 0` for the concurrent builds, per packages/db/scripts/migrate.ts.
-- CREATE INDEX CONCURRENTLY waits on every concurrent write in the database, not just
-- this table, so the session's 5s DDL timeout would cancel it (55P03) and strand an
-- INVALID index that the IF NOT EXISTS below would skip forever.
SET lock_timeout = 0;--> statement-breakpoint

-- Clear any INVALID index left by a previously cancelled build, so a replay
-- rebuilds it instead of skipping it.
DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_provider_id_unique";--> statement-breakpoint

-- Build the unique index before dropping the old plain one, so provider_id is never unindexed.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sso_provider_provider_id_unique" ON "sso_provider" USING btree ("provider_id");--> statement-breakpoint

DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_provider_id_idx";--> statement-breakpoint

SET lock_timeout = '5s';
