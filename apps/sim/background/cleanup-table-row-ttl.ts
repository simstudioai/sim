import { dbFor } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { sql } from 'drizzle-orm'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { getColumnId } from '@/lib/table/column-keys'
import { getDeleteSnapshotBatchSize } from '@/lib/table/constants'
import { signalTableRowsChanged } from '@/lib/table/events'
import { assertRowDelete, TableLockedError } from '@/lib/table/mutation-locks'
import type { DbTransaction } from '@/lib/table/planner'
import type { DeletedTableRow } from '@/lib/table/rows/ordering'
import { withLockedTable } from '@/lib/table/service'
import { fireTableTrigger } from '@/lib/table/trigger'
import { isTableRowTtlEnabled } from '@/lib/table/ttl-availability'
import type { RowData, TableSchema } from '@/lib/table/types'

const logger = createLogger('CleanupTableRowTtl')
const cleanupDb = dbFor('cleanup')

const TTL_CLEANUP_MAX_BATCHES = 100

interface ExpiredTtlTableRef {
  [key: string]: unknown
  id: string
  workspaceId: string
}

interface DeletedTtlRows {
  deleted: number
  cursor: TtlCleanupCursor | null
  rows: DeletedTableRow[]
}

type DeletedTtlBatch =
  | { attempted: false; deleted: 0; cursor: null }
  | (DeletedTtlRows & {
      attempted: true
      tableName: string
      schema: TableSchema
    })

interface TtlCleanupCursor {
  createdAt: string
  id: string
}

interface TtlTableCleanupState {
  ref: ExpiredTtlTableRef
  after?: TtlCleanupCursor
  deleted: number
  complete: boolean
}

export interface TableRowTtlCleanupResult {
  batches: number
  deleted: number
  limitReached: boolean
}

async function listExpiredTtlTables(nowEpochSeconds: number): Promise<ExpiredTtlTableRef[]> {
  const rows = await cleanupDb.execute<ExpiredTtlTableRef>(sql`
    SELECT
      ${userTableDefinitions.id} AS id,
      ${userTableDefinitions.workspaceId} AS "workspaceId"
    FROM ${userTableDefinitions}
    WHERE ${userTableDefinitions.archivedAt} IS NULL
      AND ${userTableDefinitions.deleteLocked} = false
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          COALESCE(${userTableDefinitions.schema}->'columns', '[]'::jsonb)
        ) AS ttl_column(column_definition)
        JOIN ${userTableRows} AS table_row
          ON table_row.table_id = ${userTableDefinitions.id}
         AND table_row.workspace_id = ${userTableDefinitions.workspaceId}
        WHERE ttl_column.column_definition->>'type' = 'ttl'
          AND jsonb_typeof(
            table_row.data->COALESCE(
              ttl_column.column_definition->>'id',
              ttl_column.column_definition->>'name'
            )
          ) = 'number'
          AND (
            table_row.data->>COALESCE(
              ttl_column.column_definition->>'id',
              ttl_column.column_definition->>'name'
            )
          )::numeric <= ${nowEpochSeconds}
      )
    ORDER BY
      md5(${userTableDefinitions.id} || ${nowEpochSeconds}::text),
      ${userTableDefinitions.id}
    LIMIT ${TTL_CLEANUP_MAX_BATCHES}
  `)
  return Array.isArray(rows) ? rows : []
}

function parseDeletedBatch(rows: unknown, batchSize: number): DeletedTtlRows {
  if (!Array.isArray(rows)) {
    throw new Error('Table row TTL cleanup did not return deleted rows')
  }
  const deletedRows = rows as Array<{ id?: unknown; data?: unknown; createdAt?: unknown }>
  if (deletedRows.length > batchSize) {
    throw new Error('Table row TTL cleanup returned an invalid deleted count')
  }
  const parsed = deletedRows.map((row) => {
    if (typeof row.id !== 'string') {
      throw new Error('Table row TTL cleanup did not return a row cursor')
    }
    if (typeof row.createdAt !== 'string') {
      throw new Error('Table row TTL cleanup did not return a creation-time cursor')
    }
    return {
      cursor: { createdAt: row.createdAt, id: row.id },
      row: { id: row.id, data: row.data as RowData },
    }
  })
  return {
    deleted: parsed.length,
    cursor: parsed[parsed.length - 1]?.cursor ?? null,
    rows: parsed.map(({ row }) => row),
  }
}

async function deleteExpiredTableRowBatch(
  trx: DbTransaction,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  nowEpochSeconds: number,
  batchSize: number,
  after?: TtlCleanupCursor
): Promise<DeletedTtlRows> {
  const rows = await trx.execute<{ id: string; data: RowData; createdAt: string }>(sql`
    WITH candidates AS MATERIALIZED (
      SELECT table_row.id
      FROM ${userTableRows} AS table_row
      WHERE table_row.table_id = ${tableId}
        AND table_row.workspace_id = ${workspaceId}
        ${
          after
            ? sql`AND (table_row.created_at, table_row.id) > (${after.createdAt}::timestamp, ${after.id})`
            : sql``
        }
        AND jsonb_typeof(table_row.data->${columnKey}) = 'number'
        AND (table_row.data->>${columnKey})::numeric <= ${nowEpochSeconds}
      ORDER BY table_row.created_at, table_row.id
      LIMIT ${batchSize}
      FOR UPDATE OF table_row SKIP LOCKED
    ), deleted AS (
      DELETE FROM ${userTableRows} AS table_row
      USING candidates
      WHERE table_row.id = candidates.id
      RETURNING
        table_row.id,
        table_row.data,
        to_char(table_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt"
    )
    SELECT id, data, "createdAt"
    FROM deleted
    ORDER BY "createdAt", id
  `)
  return parseDeletedBatch(rows, batchSize)
}

async function deleteExpiredRowsForTable(
  ref: ExpiredTtlTableRef,
  nowEpochSeconds: number,
  batchSize: number,
  after?: TtlCleanupCursor
): Promise<DeletedTtlBatch> {
  try {
    const batch = await withLockedTable(
      ref.id,
      async (table, trx): Promise<DeletedTtlBatch> => {
        try {
          assertRowDelete(table)
        } catch (error) {
          if (error instanceof TableLockedError) {
            return { attempted: false, deleted: 0, cursor: null }
          }
          throw error
        }

        const ttlColumn = table.schema.columns.find((column) => column.type === 'ttl')
        if (!ttlColumn) return { attempted: false, deleted: 0, cursor: null }

        const batch = await deleteExpiredTableRowBatch(
          trx,
          table.id,
          table.workspaceId,
          getColumnId(ttlColumn),
          nowEpochSeconds,
          batchSize,
          after
        )
        return {
          attempted: true,
          ...batch,
          tableName: table.name,
          schema: table.schema,
        } satisfies DeletedTtlBatch
      },
      { expectedWorkspaceId: ref.workspaceId }
    )
    if (batch.attempted && batch.rows.length > 0) {
      await fireTableTrigger(
        ref.id,
        batch.tableName,
        'delete',
        batch.rows,
        null,
        batch.schema,
        'ttl-cleanup'
      )
    }
    return batch
  } catch (error) {
    if (asOrchestrationError(error)?.code === 'not_found') {
      return { attempted: false, deleted: 0, cursor: null }
    }
    throw error
  }
}

/** Deletes rows whose table TTL cell is at or before the current Unix epoch second. */
export async function runCleanupTableRowTtl(
  signal?: AbortSignal
): Promise<TableRowTtlCleanupResult> {
  if (signal?.aborted) return { batches: 0, deleted: 0, limitReached: false }
  if (!(await isTableRowTtlEnabled())) {
    logger.info('Table row TTL cleanup skipped because the feature is disabled')
    return { batches: 0, deleted: 0, limitReached: false }
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000)
  const batchSize = getDeleteSnapshotBatchSize()
  const tableRefs = await listExpiredTtlTables(nowEpochSeconds)
  const tableStates: TtlTableCleanupState[] = tableRefs.map((ref) => ({
    ref,
    deleted: 0,
    complete: false,
  }))
  let deleted = 0
  let batches = 0

  while (
    batches < TTL_CLEANUP_MAX_BATCHES &&
    !signal?.aborted &&
    tableStates.some((state) => !state.complete)
  ) {
    for (const state of tableStates) {
      if (state.complete) continue
      if (batches === TTL_CLEANUP_MAX_BATCHES || signal?.aborted) break

      const batch = await deleteExpiredRowsForTable(
        state.ref,
        nowEpochSeconds,
        batchSize,
        state.after
      )
      if (!batch.attempted) {
        state.complete = true
        continue
      }

      batches++
      deleted += batch.deleted
      state.deleted += batch.deleted
      state.after = batch.cursor ?? undefined
      if (batch.deleted < batchSize) state.complete = true
    }
  }

  for (const state of tableStates) {
    if (state.deleted > 0) signalTableRowsChanged(state.ref.id)
  }

  const limitReached =
    batches === TTL_CLEANUP_MAX_BATCHES &&
    (tableStates.some((state) => !state.complete) || tableRefs.length === TTL_CLEANUP_MAX_BATCHES)
  logger.info('Table row TTL cleanup completed', { batches, deleted, limitReached })
  return { batches, deleted, limitReached }
}

export const cleanupTableRowTtlTask = task({
  id: 'cleanup-table-row-ttl',
  queue: { concurrencyLimit: 1 },
  run: () => runCleanupTableRowTtl(),
})
