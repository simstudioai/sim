import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { and, eq, inArray } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { Filter, RowData, TableDefinition, TableSchema } from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import { TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { appendTableEvent } from '@/lib/table/events'
import {
  getJobProgress,
  markJobCanceled,
  markJobFailed,
  markJobReady,
  updateJobProgress,
} from '@/lib/table/jobs/service'
import {
  assertRowUpdate,
  type MutationProof,
  patchColumnIds,
  TableLockedError,
} from '@/lib/table/mutation-locks'
import type { DbTransaction } from '@/lib/table/planner'
import { withLiveSchema } from '@/lib/table/rows/live-schema'
import { selectRowDataPage, updatePageByIds } from '@/lib/table/rows/ordering'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { deriveBulkUpdatePatch } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import { buildFilterClause } from '@/lib/table/sql'
import { coerceRowToSchema, uniqueColumnsInPatch, validateRowSize } from '@/lib/table/validation'

const logger = createLogger('TableUpdateRunner')

/** Emit a progress event / heartbeat at most every this many rows. */
const PROGRESS_INTERVAL_ROWS = 5000

/**
 * Thrown when this worker discovers it no longer owns the table's job (canceled, or the
 * stale-job janitor marked it failed and a newer job took over). The worker stops updating.
 */
class JobSupersededError extends Error {}

/**
 * The patch cannot be applied to the table as it now stands. Retrying cannot help: the schema that
 * refused it is the one a retry would read.
 */
export class UpdatePatchRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpdatePatchRejectedError'
  }
}

/**
 * The patch one batch writes against `live`, derived from the job's raw `patch` exactly as the
 * inline bulk update derives its own ({@link deriveBulkUpdatePatch}): cells of columns deleted since
 * `previous` dropped, the rest coerced and validated. It is refused, with an
 * {@link UpdatePatchRejectedError}, when it cannot be written to every matched row: a value the
 * columns refuse, a null in a required column, or any unique column, since one value in many rows
 * cannot stay unique. Batches derive it under the schema lock, so a column made required or unique
 * while the job waited is refused before the batch writes.
 */
function deriveJobPatch(patch: RowData, previous: TableSchema, live: TableDefinition): RowData {
  let derived: RowData
  try {
    derived = deriveBulkUpdatePatch(patch, previous, live, undefined)
  } catch (err) {
    if (err instanceof OrchestrationError && err.code === 'validation') {
      throw new UpdatePatchRejectedError(err.message)
    }
    throw err
  }
  const cleared = live.schema.columns.filter((column) => {
    const columnId = getColumnId(column)
    return (
      column.required && Object.hasOwn(derived, columnId) && (derived[columnId] ?? null) === null
    )
  })
  if (cleared.length > 0) {
    throw new UpdatePatchRejectedError(
      `Missing required field: ${cleared.map((column) => column.name).join(', ')}`
    )
  }
  const unique = uniqueColumnsInPatch(live.schema, derived)
  if (unique.length > 0) {
    throw new UpdatePatchRejectedError(
      `Cannot set unique column values when updating multiple rows: ${unique.map((column) => column.name).join(', ')}`
    )
  }
  return derived
}

/** Refuses a row that `patch`, merged over it, would leave oversized or invalid under `schema`. */
function assertMergedRowFits(
  schema: TableSchema,
  row: { id: string; data: RowData },
  patch: RowData
): void {
  const merged = { ...row.data, ...patch }
  const sizeValidation = validateRowSize(merged)
  if (!sizeValidation.valid) {
    throw new UpdatePatchRejectedError(`Row ${row.id}: ${sizeValidation.errors.join(', ')}`)
  }
  const schemaValidation = coerceRowToSchema(merged, schema)
  if (!schemaValidation.valid) {
    throw new UpdatePatchRejectedError(`Row ${row.id}: ${schemaValidation.errors.join(', ')}`)
  }
}

/** Reads a batch's rows in its transaction and refuses any `patch` would not fit under `live`. */
async function validateMergedRows(
  trx: DbTransaction,
  live: TableDefinition,
  rowIds: string[],
  patch: RowData
): Promise<void> {
  const rows = await trx
    .select({ id: userTableRows.id, data: userTableRows.data })
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, live.id), inArray(userTableRows.id, rowIds)))
  for (const row of rows)
    assertMergedRowFits(live.schema, { id: row.id, data: row.data as RowData }, patch)
}

export interface TableUpdatePayload {
  jobId: string
  tableId: string
  workspaceId: string
  /** Rows matching this filter get the patch. */
  filter: Filter
  /** Column-id-keyed partial patch merged into every matched row. */
  data: RowData
  /** Only rows created at/before this instant are patched, so mid-job inserts are spared. */
  cutoff: Date
  /** Stop after updating this many rows (an explicit caller-supplied limit). Omitted = every match. */
  maxRows?: number
}

/**
 * Background worker for large filtered row updates (trigger.dev task, or detached on the web
 * container when trigger.dev is disabled — see the update dispatch in the user_table tool).
 * Applies the same `data` patch (JSONB merge) to every row matching `filter` with
 * `created_at <= cutoff`, in keyset-paginated pages. Each page validates the merged result per
 * row, then commits in batches — **best-effort, not atomic**: committed pages persist even if a
 * later page fails validation (unlike the inline `updateRowsByFilter`, which pre-validates all
 * rows in one transaction). Reads are not masked: updated rows still exist, so mid-job reads are
 * eventually consistent. Ownership-gated per page so a cancel/supersede stops within one page.
 *
 * Unlike the inline path, the worker does NOT fire per-row table triggers or auto-recompute
 * workflow/enrichment columns — that would be a runaway cascade across thousands of rows. Run
 * the affected columns explicitly afterward if downstream recompute is needed.
 *
 * Unexpected errors are rethrown for the caller's retry machinery; the caller marks the job
 * failed via `markTableUpdateFailed`. An {@link UpdatePatchRejectedError} is rethrown too, and is
 * not worth a retry. A superseded run returns quietly.
 */
export async function runTableUpdate(payload: TableUpdatePayload): Promise<void> {
  const { jobId, tableId, workspaceId, filter, data, cutoff, maxRows } = payload
  const requestId = generateId().slice(0, 8)
  const budget = maxRows ?? Number.POSITIVE_INFINITY

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table) throw new Error(`Update target table ${tableId} not found`)

    // Gate the run on the update lock, then re-gate it before every page (see
    // the loop below), so enabling the lock stops a job that is already
    // running. Runs through `assertRowUpdate` rather than reading
    // `updateLocked` directly so the enqueue site and the worker apply
    // identical rules. This is a user-driven bulk patch, so it deliberately
    // does not pass `computedWrite` — the workflow-output carve-out belongs to
    // the cell-write path alone.
    const cancelForLock = async (processedSoFar: number): Promise<void> => {
      logger.info(`[${requestId}] Update job stopped — table is update-locked`, {
        tableId,
        jobId,
        processedSoFar,
      })
      await markJobCanceled(tableId, jobId)
      void appendTableEvent({ kind: 'job', type: 'update', tableId, jobId, status: 'canceled' })
    }

    const stopIfLocked = async (
      fresh: TableDefinition,
      processedSoFar: number
    ): Promise<MutationProof<'update'> | null> => {
      try {
        return assertRowUpdate(fresh, patchColumnIds(data))
      } catch (err) {
        if (!(err instanceof TableLockedError)) throw err
        await cancelForLock(processedSoFar)
        return null
      }
    }

    if ((await stopIfLocked(table, 0)) === null) return

    // Runs inside each batch's transaction, under the same advisory lock the
    // lock toggle and schema changes hold, so no page can be written after a
    // lock commits, nor under a schema that would not store the patch.
    const revalidate = async (trx: DbTransaction) => {
      const fresh = await getTableById(tableId, { tx: trx, includeArchived: true })
      if (fresh) assertRowUpdate(fresh, patchColumnIds(data))
      return fresh ?? undefined
    }

    const filterClause = buildFilterClause(filter, USER_TABLE_ROWS_SQL_NAME, table.schema.columns)
    if (!filterClause) throw new Error('Filter is required for bulk update')

    // `data` stays the raw payload. Each page, and each batch under the schema lock, derives the
    // patch it writes from it against the schema of that moment, as the inline update would. Derive
    // it once up front too, so a patch the table refuses fails before any page is read.
    deriveJobPatch(data, table.schema, table)

    // Resume the persisted count: a retried attempt's earlier pages are already committed, so
    // starting at zero would overwrite cumulative progress. Doubles as the initial ownership gate.
    const resumed = await getJobProgress(tableId, jobId)
    if (resumed === null) throw new JobSupersededError()

    let processed = resumed
    let lastReported = resumed
    let afterId: string | undefined

    while (processed < budget) {
      const owns = await updateJobProgress(tableId, processed, jobId)
      if (!owns) throw new JobSupersededError()

      // Cheap early-out before selecting a page we may not be allowed to
      // write. The authoritative gate is `revalidate` below, which re-asserts
      // inside each batch transaction. Pages already applied stay applied, as
      // with an explicit cancel.
      const current = await getTableById(tableId, { includeArchived: true })
      if (!current) throw new JobSupersededError()
      const pageProof = await stopIfLocked(current, processed)
      if (pageProof === null) return
      const pagePatch = deriveJobPatch(data, table.schema, current)
      // Every column the update wrote has since been deleted: nothing is left to write.
      if (Object.keys(pagePatch).length === 0) break
      const patchJson = JSON.stringify(pagePatch)

      const page = await selectRowDataPage({
        tableId,
        workspaceId,
        cutoff,
        filterClause,
        afterId,
        limit: Math.min(TABLE_LIMITS.DELETE_PAGE_SIZE, budget - processed),
        // Skip rows already carrying the patch so a retried run resumes without re-walking /
        // double-counting the rows an earlier attempt updated (updated rows still exist and may
        // still match the filter, unlike deletes).
        excludeIfPatched: patchJson,
      })
      if (page.length === 0) break
      afterId = page[page.length - 1].id

      // Validate each merged result before writing the page — a row that would overflow the size
      // cap or violate the schema fails the job (earlier pages stay applied; best-effort).
      for (const row of page) assertMergedRowFits(current.schema, row, pagePatch)

      try {
        processed += await updatePageByIds(
          tableId,
          workspaceId,
          page.map((r) => r.id),
          async (trx, fresh, batch) => {
            const live = fresh ? withLiveSchema(current, fresh.schema) : current
            const batchPatch = deriveJobPatch(data, table.schema, live)
            if (Object.keys(batchPatch).length === 0) return null
            // The page was checked against `current`; a batch under a schema that moved since is
            // checked again, against the rows as they stand, before it writes.
            if (live !== current) await validateMergedRows(trx, live, batch, batchPatch)
            return {
              patchJson: JSON.stringify(batchPatch),
              secretProvenance: createExactEmptyTableRowSecretProvenance(batchPatch),
            }
          },
          pageProof,
          revalidate
        )
      } catch (err) {
        if (!(err instanceof TableLockedError)) throw err
        // A lock landed between batches. Batches already committed stay
        // applied; `processed` undercounts them, which only affects the final
        // progress number on an already-canceled job.
        await cancelForLock(processed)
        return
      }

      if (
        processed - lastReported >= PROGRESS_INTERVAL_ROWS ||
        (lastReported === 0 && processed > 0)
      ) {
        lastReported = processed
        void appendTableEvent({
          kind: 'job',
          type: 'update',
          tableId,
          jobId,
          status: 'running',
          progress: processed,
        })
      }
    }

    await updateJobProgress(tableId, processed, jobId)
    const becameReady = await markJobReady(tableId, jobId)
    if (becameReady) {
      void appendTableEvent({
        kind: 'job',
        type: 'update',
        tableId,
        jobId,
        status: 'ready',
        progress: processed,
      })
      logger.info(`[${requestId}] Update complete`, { tableId, rows: processed })
    } else {
      logger.info(
        `[${requestId}] Update finished but no longer owns the run (canceled/superseded)`,
        {
          tableId,
          jobId,
        }
      )
    }
  } catch (err) {
    if (err instanceof JobSupersededError) {
      logger.info(`[${requestId}] Update superseded by a newer run; stopping`, { tableId, jobId })
      return
    }
    const cause = toError(err).cause
    const error = cause ? toError(cause) : toError(err)
    logger.error(`[${requestId}] Update failed for table ${tableId}:`, error)
    throw error
  }
}

/**
 * Marks the update job failed and emits the failed SSE event. Called once the caller gives up on
 * the run (trigger.dev `onFailure` after retries, or the detached fallback). Scoped to jobId — a
 * no-op if a newer job has taken over.
 */
export async function markTableUpdateFailed(
  tableId: string,
  jobId: string,
  error: unknown
): Promise<void> {
  const message = truncate(getErrorMessage(toError(error).cause ?? error, 'Update failed'), 500)
  await markJobFailed(tableId, jobId, message).catch(() => {})
  void appendTableEvent({
    kind: 'job',
    type: 'update',
    tableId,
    jobId,
    status: 'failed',
    error: message,
  })
}
