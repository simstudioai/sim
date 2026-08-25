import { dbFor } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { sql } from 'drizzle-orm'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { getColumnId } from '@/lib/table/column-keys'
import { signalTableRowsChanged } from '@/lib/table/events'
import { assertRowDelete, TableLockedError } from '@/lib/table/mutation-locks'
import type { DbTransaction } from '@/lib/table/planner'
import { withLockedTable } from '@/lib/table/service'

const logger = createLogger('CleanupTableRowTtl')
const cleanupDb = dbFor('cleanup')

const TTL_CLEANUP_BATCH_SIZE = 500
const TTL_CLEANUP_MAX_BATCHES = 100

interface ExpiredTtlTableRef {
  [key: string]: unknown
  id: string
  workspaceId: string
}

interface DeletedTtlBatch {
  attempted: boolean
  deleted: number
  lastId: string | null
}

interface TtlTableCleanupState {
  ref: ExpiredTtlTableRef
  afterId?: string
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

function parseDeletedBatch(rows: unknown): Omit<DeletedTtlBatch, 'attempted'> {
  const [row] = Array.isArray(rows)
    ? (rows as Array<{ count?: number | string; lastId?: string | null }>)
    : []
  if (!row) throw new Error('Table row TTL cleanup did not return a deleted count')

  const deleted = Number(row.count)
  if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > TTL_CLEANUP_BATCH_SIZE) {
    throw new Error('Table row TTL cleanup returned an invalid deleted count')
  }
  if (deleted > 0 && typeof row.lastId !== 'string') {
    throw new Error('Table row TTL cleanup did not return a row cursor')
  }
  return { deleted, lastId: row.lastId ?? null }
}

async function deleteExpiredTableRowBatch(
  trx: DbTransaction,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  nowEpochSeconds: number,
  afterId?: string
): Promise<Omit<DeletedTtlBatch, 'attempted'>> {
  const rows = await trx.execute<{ count: number | string; lastId: string | null }>(sql`
    WITH candidates AS MATERIALIZED (
      SELECT table_row.id
      FROM ${userTableRows} AS table_row
      WHERE table_row.table_id = ${tableId}
        AND table_row.workspace_id = ${workspaceId}
        ${afterId ? sql`AND table_row.id > ${afterId}` : sql``}
        AND jsonb_typeof(table_row.data->${columnKey}) = 'number'
        AND (table_row.data->>${columnKey})::numeric <= ${nowEpochSeconds}
      ORDER BY table_row.id
      LIMIT ${TTL_CLEANUP_BATCH_SIZE}
      FOR UPDATE OF table_row SKIP LOCKED
    ), deleted AS (
      DELETE FROM ${userTableRows} AS table_row
      USING candidates
      WHERE table_row.id = candidates.id
      RETURNING table_row.id
    )
    SELECT
      count(*)::integer AS count,
      max(id) AS "lastId"
    FROM deleted
  `)
  return parseDeletedBatch(rows)
}

async function deleteExpiredRowsForTable(
  ref: ExpiredTtlTableRef,
  nowEpochSeconds: number,
  afterId?: string
): Promise<DeletedTtlBatch> {
  try {
    return await withLockedTable(
      ref.id,
      async (table, trx) => {
        try {
          assertRowDelete(table)
        } catch (error) {
          if (error instanceof TableLockedError) {
            return { attempted: false, deleted: 0, lastId: null }
          }
          throw error
        }

        const ttlColumn = table.schema.columns.find((column) => column.type === 'ttl')
        if (!ttlColumn) return { attempted: false, deleted: 0, lastId: null }

        const batch = await deleteExpiredTableRowBatch(
          trx,
          table.id,
          table.workspaceId,
          getColumnId(ttlColumn),
          nowEpochSeconds,
          afterId
        )
        return { attempted: true, ...batch }
      },
      { expectedWorkspaceId: ref.workspaceId }
    )
  } catch (error) {
    if (asOrchestrationError(error)?.code === 'not_found') {
      return { attempted: false, deleted: 0, lastId: null }
    }
    throw error
  }
}

/** Deletes rows whose table TTL cell is at or before the current Unix epoch second. */
export async function runCleanupTableRowTtl(
  signal?: AbortSignal
): Promise<TableRowTtlCleanupResult> {
  if (signal?.aborted) return { batches: 0, deleted: 0, limitReached: false }

  const nowEpochSeconds = Math.floor(Date.now() / 1000)
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

      const batch = await deleteExpiredRowsForTable(state.ref, nowEpochSeconds, state.afterId)
      if (!batch.attempted) {
        state.complete = true
        continue
      }

      batches++
      deleted += batch.deleted
      state.deleted += batch.deleted
      state.afterId = batch.lastId ?? undefined
      if (batch.deleted < TTL_CLEANUP_BATCH_SIZE) state.complete = true
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
