import { createLogger } from '@sim/logger'
import postgres from 'postgres'

/**
 * Push-managed databases (local + dev use `db:push`) never receive the raw-SQL
 * row-count triggers that versioned migrations install on staging/prod — so every
 * table's `row_count` sat at 0 forever there (found live: the agent had to count rows
 * directly because the tables list lied). This applies the CURRENT trigger definitions
 * (verbatim from migrations 0224 and 0402: each statement logs to `user_table_row_changes`)
 * idempotently, then reconciles the stored counts so stored + unfolded log matches reality.
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
    INSERT INTO user_table_row_changes (table_id, row_delta)
    SELECT table_id, count(*)::integer FROM new_rows GROUP BY table_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_user_table_row_count_stmt()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_table_row_changes (table_id, row_delta)
    SELECT o.table_id, -count(*)::integer FROM old_rows o
    WHERE EXISTS (SELECT 1 FROM user_table_definitions d WHERE d.id = o.table_id)
    GROUP BY o.table_id;

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
  const reconciled = await sql.begin(async (tx) => {
    // Waits out any fold or row write in flight and holds off new ones, so the counts below are
    // read after the lock in one consistent snapshot rather than racing a fold's delete.
    await tx`LOCK TABLE user_table_row_changes IN EXCLUSIVE MODE`
    return tx`
      UPDATE user_table_definitions d
      SET row_count = actual.n - actual.tail
      FROM (
        SELECT d2.id,
          (SELECT count(*) FROM user_table_rows r WHERE r.table_id = d2.id)::int AS n,
          (SELECT coalesce(sum(c.row_delta), 0) FROM user_table_row_changes c
            WHERE c.table_id = d2.id)::int AS tail
        FROM user_table_definitions d2
      ) actual
      WHERE actual.id = d.id AND d.row_count IS DISTINCT FROM actual.n - actual.tail
      RETURNING d.id
    `
  })
  logger.info('Table row-count triggers applied; counts reconciled', {
    reconciledTables: reconciled.length,
  })
} finally {
  await sql.end()
}
