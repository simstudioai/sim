-- The public AgentMail webhook receiver resolves the delivering tenant by
-- `workspace.inbox_provider_id` so it verifies the Svix signature against one
-- secret instead of every tenant's. That lookup runs on an unauthenticated path,
-- so it must be indexed, and unique so "one signature check per request" holds by
-- construction. The value is an inbox id minted per workspace by `enableInbox`
-- and nulled by `disableInbox`, so it is already unique in practice. NULLs are
-- excluded: most workspaces have no inbox.
--
-- migration-safe: additive index only, no column or constraint changes. The
-- uniqueness it adds is already an invariant of the only code that writes the
-- column, and that code is unchanged by this deploy, so old and new app versions
-- both run correctly against either schema state.

-- Duplicates must be resolved first. Failing here, inside the transaction, avoids
-- letting the CONCURRENT build fail afterwards and strand an INVALID index that
-- IF NOT EXISTS would skip forever.
DO $$
DECLARE duplicate_inbox_ids text;
BEGIN
  SELECT string_agg(inbox_provider_id, ', ')
    INTO duplicate_inbox_ids
    FROM (
      SELECT "inbox_provider_id" FROM "workspace"
      WHERE "inbox_provider_id" IS NOT NULL
      GROUP BY "inbox_provider_id" HAVING count(*) > 1
    ) AS d;
  IF duplicate_inbox_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'workspace has duplicate inbox_provider_id values: %. Each AgentMail inbox belongs to one workspace; clear the stale rows (disableInbox) and re-run.',
      duplicate_inbox_ids;
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
DROP INDEX CONCURRENTLY IF EXISTS "workspace_inbox_provider_id_idx";--> statement-breakpoint

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "workspace_inbox_provider_id_idx" ON "workspace" USING btree ("inbox_provider_id") WHERE "workspace"."inbox_provider_id" IS NOT NULL;--> statement-breakpoint

SET lock_timeout = '5s';
