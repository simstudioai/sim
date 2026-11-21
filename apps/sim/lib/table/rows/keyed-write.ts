/**
 * Makes a table's rows equal to a declared set, matched by a unique key column, inside the
 * caller's transaction: workspace source's managed rows. Only what differs is written, through the
 * row service's transaction-bound writers: stored rows whose key no declared row has are deleted,
 * rows whose declared cells changed are patched (cells of other columns, a workflow group's
 * outputs say, are left alone), and new keys are inserted. A stored row with no key value (the
 * grid's "add row" makes one) is no declared row's, so it is kept, and counts toward the table's
 * row limit with the rest. An unchanged row is not touched, so its id, `updated_at`, run state and
 * provenance stay, and no trigger fires for it.
 */

import { isDeepStrictEqual } from 'node:util'
import { userTableRows } from '@sim/db/schema'
import { rowKeyText } from '@sim/workspace-code/kinds/table-rows'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableRowLimitError, wouldExceedRowLimit } from '@/lib/table/billing'
import type { DbTransaction } from '@/lib/table/planner'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import {
  batchInsertRowsWithTx,
  batchUpdateRowsWithTx,
  deleteRowsByIdsWithTx,
  dispatchAfterBatchInsert,
} from '@/lib/table/rows/service'
import { setTableTxTimeouts } from '@/lib/table/tx'
import type { JsonValue, RowData, TableDefinition } from '@/lib/table/types'
import { coerceRowToSchema } from '@/lib/table/validation'

/** The rows a keyed write makes the table hold, by column id. */
export interface KeyedRows {
  /** The id of the unique column rows are matched by. */
  keyColumnId: string
  /** The ids of the columns the rows declare; other columns' cells are left as stored. */
  columnIds: string[]
  rows: RowData[]
  /** Whether stored rows no declared row matches are deleted; otherwise they refuse the write. */
  allowDelete: boolean
  /**
   * The plan's row limit for the table (negative for none): a write that grows the table is
   * refused when the rows it leaves, the stored rows with no key value it keeps included, would
   * cross it. A write that adds no rows on balance is never refused, as other row writes are not.
   */
  rowLimit?: number
}

/** What a keyed write changed, and the triggers to fire once the transaction commits. */
export interface KeyedWriteResult {
  inserted: number
  updated: number
  deleted: number
  dispatch: () => void
}

/**
 * The statement timeout of a keyed write's statements, as the row API's standalone bulk writes set
 * it: a joined transaction otherwise keeps its opener's 10s default, too short to read, patch or
 * delete thousands of rows.
 */
const KEYED_WRITE_TIMEOUTS = { statementMs: 60_000 }

/** A cell that holds no value, as a required column counts it. */
function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

/** `row` coerced to the stored form of each column, refusing a value its column cannot hold. */
function coerced(row: RowData, table: TableDefinition, index: number): RowData {
  const copy = structuredClone(row)
  const validation = coerceRowToSchema(copy, table.schema, 'reject')
  if (!validation.valid) {
    throw new OrchestrationError('validation', `Row ${index + 1}: ${validation.errors.join(', ')}`)
  }
  return copy
}

/**
 * Diffs `declared` against the stored rows of `table` (read under the caller's lock) and writes
 * the difference: deletes first, so a key a renamed row frees can be inserted, then patches, then
 * inserts. `table` must be the definition read under the table's schema lock in `trx`.
 */
export async function writeKeyedRowsWithTx(
  trx: DbTransaction,
  table: TableDefinition,
  declared: KeyedRows,
  actor: { userId: string; capabilityGovernedUserId: string | null },
  requestId: string
): Promise<KeyedWriteResult> {
  const { keyColumnId, columnIds } = declared
  await setTableTxTimeouts(trx, KEYED_WRITE_TIMEOUTS)
  const stored = await trx
    .select({ id: userTableRows.id, data: userTableRows.data })
    .from(userTableRows)
    .where(
      and(eq(userTableRows.tableId, table.id), eq(userTableRows.workspaceId, table.workspaceId))
    )
  const storedByKey = new Map<string, { id: string; data: RowData }>()
  // A stored row with no key value is no declared row's (the grid's "add row" makes one): it is
  // never matched, and kept.
  const keyedIds = new Set<string>()
  for (const row of stored) {
    const data = row.data as RowData
    const key = rowKeyText(data[keyColumnId])
    if (key === undefined) continue
    storedByKey.set(key, { id: row.id, data })
    keyedIds.add(row.id)
  }

  const inserts: RowData[] = []
  const updates: Array<{ rowId: string; data: RowData }> = []
  const matched = new Set<string>()
  declared.rows.forEach((row, index) => {
    const desired = coerced(row, table, index)
    const key = rowKeyText(desired[keyColumnId])
    const existing = key !== undefined ? storedByKey.get(key) : undefined
    if (!existing) {
      inserts.push(desired)
      return
    }
    matched.add(existing.id)
    const patch: RowData = {}
    for (const columnId of columnIds) {
      const next = desired[columnId]
      const current = existing.data[columnId]
      if (isEmpty(next) && isEmpty(current)) continue
      if (!isDeepStrictEqual(next, current)) patch[columnId] = (next ?? null) as JsonValue
    }
    if (Object.keys(patch).length > 0) updates.push({ rowId: existing.id, data: patch })
  })
  const removed = [...keyedIds].filter((id) => !matched.has(id))
  if (removed.length > 0 && !declared.allowDelete) {
    throw new OrchestrationError(
      'validation',
      `${removed.length} stored row(s) of "${table.name}" match no declared row; deleting them needs allow-delete.`
    )
  }
  const { rowLimit } = declared
  if (
    rowLimit !== undefined &&
    inserts.length > removed.length &&
    wouldExceedRowLimit(rowLimit, stored.length - removed.length, inserts.length)
  ) {
    throw new TableRowLimitError(rowLimit)
  }

  const deletion =
    removed.length > 0 ? await deleteRowsByIdsWithTx(trx, table, removed, requestId) : undefined
  const update = await batchUpdateRowsWithTx(
    trx,
    {
      tableId: table.id,
      workspaceId: table.workspaceId,
      updates,
      actorUserId: actor.userId,
      capabilityGovernedUserId: actor.capabilityGovernedUserId,
    },
    table,
    requestId,
    { uncoercibleValues: 'reject' }
  )
  const insertion =
    inserts.length > 0
      ? await batchInsertRowsWithTx(
          trx,
          {
            tableId: table.id,
            workspaceId: table.workspaceId,
            rows: inserts,
            userId: actor.userId,
            capabilityGovernedUserId: actor.capabilityGovernedUserId,
            secretProvenance: inserts.map(createExactEmptyTableRowSecretProvenance),
          },
          table,
          requestId,
          { uncoercibleValues: 'reject' }
        )
      : undefined
  return {
    inserted: insertion?.rows.length ?? 0,
    updated: update.result.affectedCount,
    deleted: deletion?.deletedRowIds.length ?? 0,
    dispatch: () => {
      deletion?.dispatch()
      update.dispatch()
      if (insertion) {
        dispatchAfterBatchInsert(
          insertion.table,
          insertion.rows,
          requestId,
          actor.userId,
          actor.capabilityGovernedUserId
        )
      }
    },
  }
}
