/**
 * Serializes writers that could store the same value in a table's unique column.
 *
 * Uniqueness on user tables is an application-level check (a SELECT for the value), not a database
 * constraint, so two transactions writing the same value can both pass the check before either
 * commits. Each writer takes these transaction-scoped advisory locks before its check, keyed on the
 * values it writes, so the second writer's check runs after the first commits and sees its row.
 * Writers of different values never wait on each other.
 *
 * Lock order, everywhere: these locks, then the table's row-order lock, then the definition row.
 * Every transaction takes all of them at once, before the row-order lock, in one sorted order.
 */

import { compareStrings } from '@sim/utils/string'
import { type AdvisoryXactLockRequest, acquireAdvisoryXactLocks } from '@/lib/db/advisory-locks'
import { getColumnId } from '@/lib/table/column-keys'
import { columnValueForEquality } from '@/lib/table/column-types'
import type { DbTransaction } from '@/lib/table/planner'
import type { RowData, TableDefinition } from '@/lib/table/types'
import { getUniqueColumns } from '@/lib/table/validation'

const UNIQUE_LOCK_TAG = 'user_table_unique_value'

/**
 * Most value locks one transaction takes before it locks whole columns instead. Every advisory lock
 * holds a slot in the server's shared lock table, which is sized for `max_locks_per_transaction`
 * (64 by default) per connection and shared by every transaction, so a few writers each holding
 * thousands of value locks could exhaust it and fail unrelated queries. 1,000 is the largest write
 * the row APIs accept (`MAX_BULK_OPERATION_SIZE`), so ordinary writes keep per-value locks and only
 * bulk imports and larger batches serialize on the column.
 */
const MAX_VALUE_LOCKS = 1000

function columnLockKey(tableId: string, columnId: string): string {
  return `user_table_unique:${tableId}:${columnId}`
}

/**
 * Locks the unique-column values `rows` will write, before their unique check. Pass `columnIds` to
 * lock only the unique columns a patch changes; values it leaves alone are already stored.
 *
 * Each written column takes a shared column lock, then an exclusive lock per value. The value key
 * is the same normalization the batch check compares (`columnValueForEquality`, then JSON), so two
 * values the check treats as equal always share a key; null cells never conflict and take none.
 * A column falls back to one exclusive column lock when a value is an object or array (a `json`
 * column's check matches by containment, which no single key can express), and every column does
 * when the transaction would exceed {@link MAX_VALUE_LOCKS}. An exclusive column lock waits for,
 * and blocks, every shared holder, so the fallback still serializes against per-value writers.
 */
export async function lockUniqueValues(
  trx: DbTransaction,
  table: TableDefinition,
  rows: readonly RowData[],
  columnIds?: ReadonlySet<string>
): Promise<void> {
  const columnLocks = new Map<string, boolean>()
  const valueKeys = new Set<string>()
  for (const column of getUniqueColumns(table.schema)) {
    const columnId = getColumnId(column)
    if (columnIds && !columnIds.has(columnId)) continue
    const columnKey = columnLockKey(table.id, columnId)
    const keys: string[] = []
    let byValue = true
    for (const row of rows) {
      const value = row[columnId]
      if (value === null || value === undefined) continue
      if (typeof value === 'object') {
        byValue = false
        break
      }
      keys.push(`${columnKey}:${JSON.stringify(columnValueForEquality(value, column))}`)
    }
    if (byValue && keys.length === 0) continue
    columnLocks.set(columnKey, byValue)
    if (byValue) for (const key of keys) valueKeys.add(key)
  }

  const byValue = valueKeys.size <= MAX_VALUE_LOCKS
  const locks: AdvisoryXactLockRequest[] = [...columnLocks.keys()]
    .sort(compareStrings)
    .map((key) => ({ key, shared: byValue && (columnLocks.get(key) ?? false) }))
  if (byValue) {
    for (const key of [...valueKeys].sort(compareStrings)) locks.push({ key, shared: false })
  }
  await acquireAdvisoryXactLocks(trx, UNIQUE_LOCK_TAG, locks)
}

/**
 * Locks every unique column of `table` exclusively, for writers that replace the table's rows
 * wholesale and so conflict with any concurrent write of a unique value.
 */
export async function lockUniqueColumns(trx: DbTransaction, table: TableDefinition): Promise<void> {
  const locks = getUniqueColumns(table.schema)
    .map((column) => columnLockKey(table.id, getColumnId(column)))
    .sort(compareStrings)
    .map((key) => ({ key, shared: false }))
  await acquireAdvisoryXactLocks(trx, UNIQUE_LOCK_TAG, locks)
}
