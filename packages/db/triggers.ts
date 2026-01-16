/**
 * PostgreSQL trigger definitions for user tables.
 *
 * These triggers automatically maintain row counts in user_table_definitions.
 * They are created as part of the migration but this file provides TypeScript
 * definitions for reference and programmatic trigger management if needed.
 */

import { db } from './index'

/**
 * SQL for creating the increment row count function and trigger.
 * This function runs AFTER INSERT on user_table_rows.
 */
export const INCREMENT_ROW_COUNT_SQL = `
CREATE OR REPLACE FUNCTION increment_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_table_definitions
  SET row_count = row_count + 1
  WHERE id = NEW.table_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_increment_row_count ON user_table_rows;
CREATE TRIGGER trg_increment_row_count
AFTER INSERT ON user_table_rows
FOR EACH ROW
EXECUTE FUNCTION increment_table_row_count();
`

/**
 * SQL for creating the decrement row count function and trigger.
 * This function runs AFTER DELETE on user_table_rows.
 */
export const DECREMENT_ROW_COUNT_SQL = `
CREATE OR REPLACE FUNCTION decrement_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_table_definitions
  SET row_count = GREATEST(0, row_count - 1)
  WHERE id = OLD.table_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decrement_row_count ON user_table_rows;
CREATE TRIGGER trg_decrement_row_count
AFTER DELETE ON user_table_rows
FOR EACH ROW
EXECUTE FUNCTION decrement_table_row_count();
`

/**
 * Creates or replaces the row count triggers on user_table_rows.
 * This is idempotent and can be safely called multiple times.
 *
 * @remarks
 * These triggers are typically created via migrations. This function
 * is provided for programmatic trigger management if needed.
 *
 * @example
 * ```ts
 * import { ensureRowCountTriggers } from '@sim/db/triggers'
 *
 * await ensureRowCountTriggers()
 * ```
 */
export async function ensureRowCountTriggers(): Promise<void> {
  await db.execute(INCREMENT_ROW_COUNT_SQL)
  await db.execute(DECREMENT_ROW_COUNT_SQL)
}

/**
 * Verifies that row count triggers exist on user_table_rows.
 *
 * @returns Object with status of each trigger
 */
export async function verifyRowCountTriggers(): Promise<{
  incrementTrigger: boolean
  decrementTrigger: boolean
}> {
  const result = (await db.execute(`
    SELECT tgname 
    FROM pg_trigger 
    WHERE tgname IN ('trg_increment_row_count', 'trg_decrement_row_count')
      AND NOT tgisinternal
  `)) as { tgname: string }[]

  const triggers = Array.isArray(result) ? result.map((r) => r.tgname) : []

  return {
    incrementTrigger: triggers.includes('trg_increment_row_count'),
    decrementTrigger: triggers.includes('trg_decrement_row_count'),
  }
}
