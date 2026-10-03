-- Custom SQL migration file, put your code below! --

-- Contract of #4915 (migration 0233), which moved import job state out of these five
-- `user_table_definitions` columns into `table_jobs` and removed every application read
-- and write in the same release. 0233 deferred the drop on purpose so the then-deployed
-- app version could keep using the columns across blue/green cutover; that deploy drained
-- long ago (0233 is 77 migrations back). The deferral was never recorded with a
-- `contract-pending` marker, which is why it went unnoticed.
--
-- This is a custom migration because Drizzle cannot generate it: #4915 removed the fields
-- from `schema.ts` in the same release, so every meta snapshot from 0233 onward already
-- omits them. `drizzle-kit generate` diffs schema-vs-snapshot, never schema-vs-database,
-- and reports "No schema changes, nothing to migrate" — the columns exist only physically.
--
-- Verified before writing: zero references to any of the five names (snake_case or
-- camelCase) anywhere outside packages/db/migrations, and in production all five are empty
-- across all 42,394 `user_table_definitions` rows.
--
-- One statement, not five: each ALTER takes its own ACCESS EXCLUSIVE lock on a write-hot
-- relation, and the runner retries the whole file on lock_timeout (5s, 8 attempts). A single
-- statement means one lock acquisition and no partially-dropped state between retries. Each
-- clause is IF EXISTS so the replay is a no-op. No CASCADE on purpose — nothing depends on
-- these columns (verified: no index, constraint, view, rule, trigger, function, publication,
-- or generated column references them in production), so if that ever changed this would
-- fail loudly instead of silently dropping the dependent object.

-- migration-safe: contract of #4915 — the last readers/writers were removed there and 0233 backfilled the data into table_jobs; 0 refs remain anywhere in apps/ or packages/, and all five columns are empty across all 42,394 production rows
ALTER TABLE "user_table_definitions"
	DROP COLUMN IF EXISTS "import_status",
	DROP COLUMN IF EXISTS "import_id",
	DROP COLUMN IF EXISTS "import_error",
	DROP COLUMN IF EXISTS "import_rows_processed",
	DROP COLUMN IF EXISTS "import_started_at";