/**
 * A table's live `row_count` and `rows_version`: the values stored on `user_table_definitions`
 * plus the tail of `user_table_row_changes` not yet folded into them.
 *
 * Row writes only append to the change log, so no writer waits on another for the shared
 * definition row, which otherwise stays locked until a standby acknowledges the commit. The fold
 * moves a table's log rows into the definition row and deletes them in one transaction, so stored
 * value + tail is the same immediately before and after it. `updated_at` moves only at the fold, so
 * it trails the last insert or delete by up to one sweep.
 *
 * Three rules keep `rows_version` exact for the snapshot cache and its mount-safety check:
 * - Read stored value and tail in ONE statement on the primary, so both come from one snapshot.
 *   Two statements could straddle a fold and count its rows twice or not at all.
 * - Only the fold deletes log rows.
 * - The version is a count of log rows, never `max(id)`: ids are allocated
 *   before commit, so a row that commits late can carry a lower id than one already seen.
 */

import { db } from '@sim/db'
import { userTableDefinitions, userTableRowChanges } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { setTableTxTimeouts } from '@/lib/table/tx'

const logger = createLogger('TableRowChanges')

/** Tables folded per sweep query; the sweep loops until the log is empty or its budget runs out. */
const FOLD_SWEEP_PAGE_SIZE = 500

/**
 * Live row count, for a select over `user_table_definitions`. Spelled with explicit table names:
 * drizzle prints bare column names in a subquery, where `id` would bind to the log's own column.
 */
export const currentRowCountSql = sql<number>`(user_table_definitions.row_count + coalesce((
  select sum(c.row_delta) from user_table_row_changes c
  where c.table_id = user_table_definitions.id
), 0))::integer`.mapWith(Number)

/** Live rows version, for a select over `user_table_definitions`. */
const currentRowsVersionSql = sql<number>`(user_table_definitions.rows_version + (
  select count(*) from user_table_row_changes c
  where c.table_id = user_table_definitions.id
))::bigint`.mapWith(Number)

/**
 * The table's live `rows_version`, or `null` when no such table exists (in `workspaceId`, when
 * given). Always reads the primary.
 */
export async function readCurrentRowsVersion(
  tableId: string,
  workspaceId?: string
): Promise<number | null> {
  const [row] = await db
    .select({ rowsVersion: currentRowsVersionSql })
    .from(userTableDefinitions)
    .where(
      workspaceId
        ? and(
            eq(userTableDefinitions.id, tableId),
            eq(userTableDefinitions.workspaceId, workspaceId)
          )
        : eq(userTableDefinitions.id, tableId)
    )
    .limit(1)
  return row?.rowsVersion ?? null
}

/**
 * Folds one table's change log into its definition row. Skips the table, returning `false`, when
 * another transaction holds the definition row (a schema change, or a concurrent fold), so the fold
 * never waits on it; the next sweep retries.
 */
export async function foldTableRowChanges(tableId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await setTableTxTimeouts(tx)
    const rows = await tx.execute<{ locked: boolean }>(sql`
      WITH target AS (
        SELECT id FROM user_table_definitions WHERE id = ${tableId}
        FOR NO KEY UPDATE SKIP LOCKED
      ), folded AS (
        DELETE FROM user_table_row_changes c USING target
        WHERE c.table_id = target.id
        RETURNING c.row_delta
      ), totals AS (
        SELECT count(*) AS n,
               coalesce(sum(row_delta), 0) AS delta,
               bool_or(row_delta <> 0) AS rows_added_or_removed
        FROM folded
      ), applied AS (
        UPDATE user_table_definitions d SET
          rows_version = d.rows_version + totals.n,
          row_count = greatest(d.row_count + totals.delta, 0),
          updated_at = CASE WHEN totals.rows_added_or_removed
            THEN timezone('UTC', now()) ELSE d.updated_at END
        FROM target, totals
        WHERE d.id = target.id AND totals.n > 0
      )
      SELECT EXISTS (SELECT 1 FROM target) AS locked`)
    return rows[0]?.locked === true
  })
}

export interface FoldSweepResult {
  folded: number
  skipped: number
  budgetExhausted: boolean
}

/**
 * Folds each table with unfolded log rows once, until none is left or `budgetMs` elapses. Rows a
 * table logs after its fold wait for the next sweep.
 */
export async function foldPendingTableRowChanges(budgetMs: number): Promise<FoldSweepResult> {
  const deadline = Date.now() + budgetMs
  const visited = new Set<string>()
  let folded = 0
  let skipped = 0

  for (;;) {
    const pending = await db
      .selectDistinct({ tableId: userTableRowChanges.tableId })
      .from(userTableRowChanges)
      .where(visited.size > 0 ? notInArray(userTableRowChanges.tableId, [...visited]) : undefined)
      .limit(FOLD_SWEEP_PAGE_SIZE)
    if (pending.length === 0) return { folded, skipped, budgetExhausted: false }

    for (const { tableId } of pending) {
      if (Date.now() >= deadline) {
        logger.warn('Table row-change fold sweep ran out of budget', { folded, skipped, budgetMs })
        return { folded, skipped, budgetExhausted: true }
      }
      visited.add(tableId)
      if (await foldTableRowChanges(tableId)) folded++
      else skipped++
    }
  }
}
