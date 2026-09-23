import { createLogger } from '@sim/logger'
import postgres from 'postgres'

/**
 * Push-managed databases (local + dev use `db:push`) never receive the raw-SQL
 * row-count triggers that versioned migrations install on staging/prod — so every
 * table's `row_count` sat at 0 forever there (found live: the agent had to count rows
 * directly because the tables list lied). This applies the CURRENT trigger definitions
 * (verbatim from migrations 0224/0241/0289) idempotently, then reconciles the stored
 * counts with reality once. Runs in the dev migrate lane after `db:push`.
 */
const logger = createLogger('DevTableTriggers')

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) {
  throw new Error('Missing MIGRATION_DATABASE_URL or DATABASE_URL')
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  max_lifetime: null,
  connection: { application_name: 'sim-dev-table-triggers' },
})

const TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION increment_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions d
    SET row_count = d.row_count + c.n,
        updated_at = timezone('UTC', now())
    FROM (
        SELECT table_id, count(*)::int AS n
        FROM new_rows
        GROUP BY table_id
    ) c
    WHERE d.id = c.table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions d
    SET row_count = GREATEST(d.row_count - c.n, 0),
        updated_at = timezone('UTC', now())
    FROM (
        SELECT table_id, count(*)::int AS n
        FROM old_rows
        GROUP BY table_id
    ) c
    WHERE d.id = c.table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Legacy row-level triggers (pre-0224): coexisting with the stmt triggers they
-- double-count — dev had the legacy delete trigger still installed, decrementing twice.
DROP TRIGGER IF EXISTS user_table_rows_insert_trigger ON user_table_rows;
DROP TRIGGER IF EXISTS user_table_rows_delete_trigger ON user_table_rows;

DROP TRIGGER IF EXISTS user_table_rows_insert_stmt_trigger ON user_table_rows;
CREATE TRIGGER user_table_rows_insert_stmt_trigger
    AFTER INSERT ON user_table_rows
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION increment_user_table_row_count_stmt();

DROP TRIGGER IF EXISTS user_table_rows_delete_stmt_trigger ON user_table_rows;
CREATE TRIGGER user_table_rows_delete_stmt_trigger
    AFTER DELETE ON user_table_rows
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION decrement_user_table_row_count_stmt();
`

try {
  await sql.unsafe(TRIGGER_SQL)
  const reconciled = await sql`
    UPDATE user_table_definitions d
    SET row_count = actual.n
    FROM (
      SELECT d2.id, count(r.id)::int AS n
      FROM user_table_definitions d2
      LEFT JOIN user_table_rows r ON r.table_id = d2.id
      GROUP BY d2.id
    ) actual
    WHERE actual.id = d.id AND d.row_count IS DISTINCT FROM actual.n
    RETURNING d.id
  `
  logger.info('Table row-count triggers applied; counts reconciled', {
    reconciledTables: reconciled.length,
  })
} finally {
  await sql.end()
}
