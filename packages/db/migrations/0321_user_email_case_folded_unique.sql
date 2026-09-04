-- One account per email address, compared the way an address actually identifies a person.
--
-- `user.email` is unique byte-for-byte only, so `Alice@corp.com` and `alice@corp.com` can both
-- exist today. Every identity binding in the product compares the case-folded address —
-- credential-group enrollments now, the `u:` document access token next — so those two rows are
-- one identity to it: an enrollment for either matches both, and each account receives access
-- granted to the other. This index is the constraint that makes that state unreachable.
--
-- Transaction shape: the pre-check runs inside the runner's batch transaction, so a database that
-- already holds a duplicate fails the deploy with a sentence naming the problem, and rolls back
-- having changed nothing. Without it the concurrent build would fail on the first duplicate and
-- leave an INVALID index that the `IF NOT EXISTS` below skips on every later run — the constraint
-- would appear to exist while enforcing nothing, which is the one outcome worth engineering
-- against. The embedded COMMIT then ends the batch so the build can run CONCURRENTLY: `user` is
-- hot, and a plain CREATE UNIQUE INDEX would write-block it for the whole build. Everything after
-- the COMMIT runs in autocommit and must survive a replay, hence the DROP/IF NOT EXISTS pair.
DO $$
DECLARE
  duplicate_addresses bigint;
BEGIN
  SELECT count(*) INTO duplicate_addresses
  FROM (SELECT 1 FROM "user" GROUP BY lower(btrim("email")) HAVING count(*) > 1) AS d;

  IF duplicate_addresses > 0 THEN
    RAISE EXCEPTION
      'Cannot create user_email_lower_unique: % email address(es) are held by more than one account. Merge the duplicate accounts, then re-run this migration.',
      duplicate_addresses;
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: replay removes an invalid build left by an earlier attempt; concurrent operations preserve writes.
DROP INDEX CONCURRENTLY IF EXISTS "user_email_lower_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "user_email_lower_unique" ON "user" USING btree (lower(btrim("email")));--> statement-breakpoint
SET lock_timeout = '5s';
