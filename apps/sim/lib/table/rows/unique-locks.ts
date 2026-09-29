/**
 * Serializes writers that could store the same value in a table's unique column.
 *
 * Uniqueness on user tables is an application-level check (a SELECT for the value), not a database
 * constraint, so two transactions writing the same value can both pass the check before either
 * commits. Each writer takes these transaction-scoped advisory locks before its check, keyed on the
 * values it writes, so the second writer's check runs after the first commits and sees its row.
 * Writers of different values never wait on each other.
 *
 * Lock order, everywhere: the table's schema lock (shared by row writes, exclusive by schema
 * changes; see `live-schema.ts`), then the table's unique lock and its value locks in sorted order,
 * in one statement, then the table's row-order lock, then the definition row.
 */

import { compareStrings } from '@sim/utils/string'
import { type AdvisoryXactLockRequest, acquireAdvisoryXactLocks } from '@/lib/db/advisory-locks'
import { getColumnId } from '@/lib/table/column-keys'
import type { DbTransaction } from '@/lib/table/planner'
import type { RowData, TableDefinition } from '@/lib/table/types'
import { cellOf, getUniqueColumns, uniqueValueKey } from '@/lib/table/validation'

const UNIQUE_LOCK_TAG = 'user_table_unique_value'

/**
 * Most value locks one transaction takes before it locks the table's unique values as a whole.
 * Every advisory lock holds a slot in the server's shared lock table, which is sized at
 * `max_locks_per_transaction` (64 by default) × connections and shared by every transaction, so
 * concurrent writers each holding more than their per-connection share can exhaust it and fail
 * unrelated queries with `out of shared memory`. Capping at that per-connection budget keeps
 * ordinary writes on per-value locks while larger batches serialize on the table.
 */
const MAX_VALUE_LOCKS = 64

/**
 * One lock per table over all its unique columns: value writers hold it shared, and writers that
 * cannot lock by value hold it exclusively. A single key bounds a transaction at one lock plus its
 * value locks, however many unique columns the schema has.
 */
function tableLockKey(tableId: string): string {
  return `user_table_unique:${tableId}`
}

/**
 * Locks the unique-column values `rows` will write, before their unique check. Pass `columnIds` to
 * lock only the unique columns a patch changes; values it leaves alone are already stored.
 *
 * The table lock is taken shared, then an exclusive lock per value. The value key includes
 * `uniqueValueKey`, so two values the check treats as equal always share a key, objects and arrays
 * included, since the check compares those by jsonb equality; null cells never conflict and take
 * none. The table lock is taken exclusively instead, with no value locks, when the transaction would
 * exceed {@link MAX_VALUE_LOCKS}. An exclusive holder waits for, and blocks, every shared holder, so
 * it still serializes against per-value writers.
 */
export async function lockUniqueValues(
  trx: DbTransaction,
  table: TableDefinition,
  rows: readonly RowData[],
  columnIds?: ReadonlySet<string>
): Promise<void> {
  const tableKey = tableLockKey(table.id)
  const valueKeys = new Set<string>()
  for (const column of getUniqueColumns(table.schema)) {
    const columnId = getColumnId(column)
    if (columnIds && !columnIds.has(columnId)) continue
    for (const row of rows) {
      const value = cellOf(row, columnId)
      if (value === null || value === undefined) continue
      const key = `${tableKey}:${columnId}:${uniqueValueKey(value, column)}`
      if (!valueKeys.has(key) && valueKeys.size === MAX_VALUE_LOCKS) {
        return lockUniqueColumns(trx, table)
      }
      valueKeys.add(key)
    }
  }
  if (valueKeys.size === 0) return

  const locks: AdvisoryXactLockRequest[] = [{ key: tableKey, shared: true }]
  for (const key of [...valueKeys].sort(compareStrings)) locks.push({ key, shared: false })
  await acquireAdvisoryXactLocks(trx, UNIQUE_LOCK_TAG, locks)
}

/**
 * Locks every unique value of `table` exclusively, for writers that replace the table's rows
 * wholesale and so conflict with any concurrent write of a unique value. It locks even a table with
 * no unique columns yet: a writer holding an older schema may still hold the lock shared, and a
 * whole-table writer that adds a unique column must already hold it before the row-order lock.
 */
export async function lockUniqueColumns(trx: DbTransaction, table: TableDefinition): Promise<void> {
  await acquireAdvisoryXactLocks(trx, UNIQUE_LOCK_TAG, [
    { key: tableLockKey(table.id), shared: false },
  ])
}
