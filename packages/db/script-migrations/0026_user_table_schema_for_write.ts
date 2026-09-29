import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import postgres, { type Sql } from 'postgres'

/**
 * Installs `user_table_schema_for_write(table_id)`, which takes a table's schema lock shared and
 * returns the schema a row write must validate against. Every row write in `apps/sim` calls it, so
 * it is a script migration: `db:push` builds a database from `schema.ts` and the script migrations
 * it lists, never from the SQL migrations.
 *
 * Schema changes hold the advisory lock `user_table_schema:<table id>` exclusively while they
 * check stored rows against the new schema (`withLockedTable`), so a row write holds it shared
 * for its whole transaction: a change waits for writes in flight, and a write that waited must
 * validate against the change it waited for. The key and hash match `acquireAdvisoryXactLock`.
 *
 * The function must stay VOLATILE. Under READ COMMITTED a volatile function takes a fresh
 * snapshot for each query it runs, so the read below sees a schema change that committed while
 * the lock waited, even though the calling statement's snapshot predates it. A STABLE function
 * would read through the caller's snapshot and return the schema from before the wait. Folding
 * the lock and the read into one call lets a writer take both inside a statement it already runs.
 *
 * The schema lock waits under the caller's `statement_timeout`, not its `lock_timeout`. A schema
 * change (a retype, a constraint scan, an import) can hold the lock far longer than the short
 * `lock_timeout` a writer sets for its row locks, and failing an edit there turns an ordinary wait
 * into an error; a writer that set no timeouts keeps waiting as it did before the guard existed.
 * The value is read here rather than left to `statement_timeout` itself because a writer applies
 * its timeouts in the same statement that calls this function, and a statement's own timeout is
 * armed before it runs. The caller's `lock_timeout` is restored before the function returns, so the
 * rest of the transaction's locks keep their bound.
 *
 * Returns NULL when the table does not exist. `CREATE OR REPLACE` makes it safe to run again.
 */
export async function installUserTableSchemaForWrite(sql: Sql): Promise<void> {
  await sql.unsafe(`CREATE OR REPLACE FUNCTION "public"."user_table_schema_for_write"(p_table_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller_lock_timeout text := current_setting('lock_timeout');
BEGIN
  PERFORM set_config('lock_timeout', current_setting('statement_timeout'), true);
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('user_table_schema:' || p_table_id, 0));
  PERFORM set_config('lock_timeout', caller_lock_timeout, true);
  RETURN (SELECT "schema" FROM "public"."user_table_definitions" WHERE "id" = p_table_id);
END;
$$`)
}

export const userTableSchemaForWriteMigration: ScriptMigration = {
  name: '0026_user_table_schema_for_write',
  up: installUserTableSchemaForWrite,
}

/** Run directly by `db:push`. */
if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required to install user_table_schema_for_write')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await installUserTableSchemaForWrite(sql)
  } finally {
    await sql.end()
  }
}
