-- An organization may run several identity providers, but sign-in routes by email domain, so
-- each of its domains must name exactly one provider. The registration route checks this before
-- writing, but that check is a plain read: two concurrent registrations with different provider
-- ids can both see no sibling and both land. This index makes the invariant hold at the database.
--
-- Keyed on the same expression the verify and resolve paths compare domains with, so a legacy
-- leading `*.` or stray case cannot slip a second provider onto a domain already routed.
--
-- Duplicates must be resolved first. Failing here, inside the transaction, avoids letting the
-- CONCURRENT build fail afterwards and strand an INVALID index that IF NOT EXISTS would skip
-- forever. Which row survives is a judgement call, so this reports the ids and stops.
DO $$
DECLARE duplicate_provider_ids text;
BEGIN
  SELECT string_agg(provider_id, ', ')
    INTO duplicate_provider_ids
    FROM "sso_provider"
    WHERE "organization_id" IS NOT NULL
      AND ("organization_id", lower(regexp_replace(btrim("domain"), '^\*\.', ''))) IN (
        SELECT "organization_id", lower(regexp_replace(btrim("domain"), '^\*\.', ''))
          FROM "sso_provider"
         WHERE "organization_id" IS NOT NULL
         GROUP BY 1, 2
        HAVING count(*) > 1
      );
  IF duplicate_provider_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'sso_provider has several providers on one organization domain: %. Keep one provider per (organization, domain) and re-run.',
      duplicate_provider_ids;
  END IF;
END $$;--> statement-breakpoint

COMMIT;--> statement-breakpoint

-- `lock_timeout = 0` for the concurrent build, per packages/db/scripts/migrate.ts.
-- CREATE INDEX CONCURRENTLY waits on every concurrent write in the database, not just
-- this table, so the session's 5s DDL timeout would cancel it (55P03) and strand an
-- INVALID index that the IF NOT EXISTS below would skip forever.
SET lock_timeout = 0;--> statement-breakpoint

-- Clear any INVALID index left by a previously cancelled build, so a replay
-- rebuilds it instead of skipping it.
DROP INDEX CONCURRENTLY IF EXISTS "sso_provider_org_domain_unique";--> statement-breakpoint

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sso_provider_org_domain_unique" ON "sso_provider" USING btree ("organization_id", lower(regexp_replace(btrim("domain"), '^\*\.', ''))) WHERE "sso_provider"."organization_id" is not null;--> statement-breakpoint

SET lock_timeout = '5s';
