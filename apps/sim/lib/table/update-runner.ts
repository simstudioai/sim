import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import type { Filter, RowData } from '@/lib/table'
import { TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { appendTableEvent } from '@/lib/table/events'
import {
  getJobProgress,
  markJobFailed,
  markJobReady,
  updateJobProgress,
} from '@/lib/table/jobs/service'
import { selectRowDataPage, updatePageByIds } from '@/lib/table/rows/ordering'
import { getTableById } from '@/lib/table/service'
import { buildFilterClause } from '@/lib/table/sql'
import { coerceRowToSchema, coerceRowValues, validateRowSize } from '@/lib/table/validation'

const logger = createLogger('TableUpdateRunner')

/** Emit a progress event / heartbeat at most every this many rows. */
const PROGRESS_INTERVAL_ROWS = 5000

/**
 * Thrown when this worker discovers it no longer owns the table's job (canceled, or the
 * stale-job janitor marked it failed and a newer job took over). The worker stops updating.
 */
class JobSupersededError extends Error {}

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
 * failed via `markTableUpdateFailed`. A superseded run returns quietly.
 */
export async function runTableUpdate(payload: TableUpdatePayload): Promise<void> {
  const { jobId, tableId, workspaceId, filter, data, cutoff, maxRows } = payload
  const requestId = generateId().slice(0, 8)
  const budget = maxRows ?? Number.POSITIVE_INFINITY

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table) throw new Error(`Update target table ${tableId} not found`)

    const filterClause = buildFilterClause(filter, USER_TABLE_ROWS_SQL_NAME, table.schema.columns)
    if (!filterClause) throw new Error('Filter is required for bulk update')

    // Coerce the patch once to the schema's types — the merged validation below and the persisted
    // JSONB merge both use this normalized copy.
    coerceRowValues(data, table.schema)
    const patchJson = JSON.stringify(data)

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
      for (const row of page) {
        const merged = { ...row.data, ...data }
        const sizeValidation = validateRowSize(merged)
        if (!sizeValidation.valid) {
          throw new Error(`Row ${row.id}: ${sizeValidation.errors.join(', ')}`)
        }
        const schemaValidation = coerceRowToSchema(merged, table.schema)
        if (!schemaValidation.valid) {
          throw new Error(`Row ${row.id}: ${schemaValidation.errors.join(', ')}`)
        }
      }

      processed += await updatePageByIds(
        tableId,
        workspaceId,
        page.map((r) => r.id),
        patchJson
      )

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
