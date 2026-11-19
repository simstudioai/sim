import { createLogger } from '@sim/logger'
import postgres from 'postgres'

/**
 * Push-managed databases (local + dev use `db:push`, which runs this after every push) never
 * receive the raw-SQL triggers that versioned migrations install on staging/prod, so every
 * table's `row_count` and `rows_version` sat at 0 forever there. This applies the CURRENT
 * definitions idempotently: the statement-level INSERT/DELETE row-count triggers (0224, bodies
 * from 0402), the deferred UPDATE trigger that bumps `rows_version` once per transaction (0390,
 * body from 0402) and the deferred `table_id` foreign key (0390). Each logs to
 * `user_table_row_changes`. It then reconciles the stored counts so stored + unfolded log matches
 * reality. On a migrated database every statement replaces an object with its identical self.
 */
const logger = createLogger('DevTableTriggers')

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('Missing DATABASE_URL')
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  max_lifetime: null,
  onnotice: () => undefined,
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

CREATE OR REPLACE FUNCTION bump_user_table_rows_version_at_commit()
RETURNS TRIGGER AS $$
DECLARE
    bumped text := coalesce(current_setting('sim_rows_version.bumped', true), '');
BEGIN
    IF position(',' || NEW.table_id || ',' IN ',' || bumped || ',') = 0 THEN
        PERFORM set_config(
            'sim_rows_version.bumped',
            CASE WHEN bumped = '' THEN NEW.table_id ELSE bumped || ',' || NEW.table_id END,
            true
        );
        INSERT INTO user_table_row_changes (table_id, row_delta)
        SELECT NEW.table_id, 0
        WHERE EXISTS (SELECT 1 FROM user_table_definitions d WHERE d.id = NEW.table_id);
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_table_rows_version_update_trigger ON user_table_rows;
CREATE CONSTRAINT TRIGGER user_table_rows_version_update_trigger
    AFTER UPDATE OF data, order_key ON user_table_rows
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (
        OLD.data IS DISTINCT FROM NEW.data
        OR OLD.order_key IS DISTINCT FROM NEW.order_key
    )
    EXECUTE FUNCTION bump_user_table_rows_version_at_commit();

-- Pre-0402 statement-level version triggers: alongside the triggers above they double-bump.
DROP TRIGGER IF EXISTS user_table_rows_version_insert_trigger ON user_table_rows;
DROP TRIGGER IF EXISTS user_table_rows_version_delete_trigger ON user_table_rows;
DROP FUNCTION IF EXISTS bump_user_table_rows_version();

ALTER TABLE user_table_rows
    ALTER CONSTRAINT user_table_rows_table_id_user_table_definitions_id_fk
    DEFERRABLE INITIALLY DEFERRED;
`

try {
  // One transaction, so a concurrent row write never sees the triggers half swapped.
  await sql.begin((tx) => tx.unsafe(TRIGGER_SQL))
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
