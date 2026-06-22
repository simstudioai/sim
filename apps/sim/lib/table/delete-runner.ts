import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import type { Filter } from '@/lib/table'
import { TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { appendTableEvent } from '@/lib/table/events'
import {
  getJobProgress,
  markJobFailed,
  markJobReady,
  updateJobProgress,
} from '@/lib/table/jobs/service'
import { deletePageByIds, selectRowIdPage } from '@/lib/table/rows/ordering'
import { getTableById } from '@/lib/table/service'
import { buildFilterClause } from '@/lib/table/sql'

const logger = createLogger('TableDeleteRunner')

/** Emit a progress event / heartbeat at most every this many rows. */
const PROGRESS_INTERVAL_ROWS = 5000

/**
 * Thrown when this worker discovers it no longer owns the table's job (canceled, or the
 * stale-job janitor marked it failed and a newer job took over). The worker stops deleting.
 */
class JobSupersededError extends Error {}

export interface TableDeletePayload {
  jobId: string
  tableId: string
  workspaceId: string
  /** Optional filter narrowing which rows to delete; omitted = every row at/under the cutoff. */
  filter?: Filter
  /** Rows to spare ("select all, minus these"). Bounded by `MAX_EXCLUDE_ROW_IDS`. */
  excludeRowIds?: string[]
  /** Only rows created at/before this instant are deleted, so mid-job inserts survive. */
  cutoff: Date
  /**
   * Stop after deleting this many rows (an explicit caller-supplied limit). Omitted = every match.
   * Not combined with `excludeRowIds` (the UI's select-all path uses excludes and no cap; the
   * copilot tool uses a cap and no excludes), so the per-page fetch can be bounded directly.
   */
  maxRows?: number
}

/**
 * Background worker for large filtered row deletes (trigger.dev task, or detached on the web
 * container when trigger.dev is disabled — see the delete-async kickoff route). Deletes in
 * keyset-paginated pages — `created_at <= cutoff` spares rows inserted while the job runs, and
 * `excludeRowIds` spares specific rows (the "select all then deselect a few" case).
 * Ownership-gated per page so a cancel/supersede stops it within one page; committed batches are
 * never rolled back. Progress and the terminal state are surfaced via the table-events SSE
 * stream.
 *
 * Unexpected errors are rethrown so the caller's retry machinery sees them — the caller marks
 * the job failed via `markTableDeleteFailed` once it gives up. A superseded run (cancel, or a
 * newer job took the table) returns quietly.
 */
export async function runTableDelete(payload: TableDeletePayload): Promise<void> {
  const { jobId, tableId, workspaceId, filter, excludeRowIds, cutoff, maxRows } = payload
  const requestId = generateId().slice(0, 8)
  const budget = maxRows ?? Number.POSITIVE_INFINITY

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table) throw new Error(`Delete target table ${tableId} not found`)

    const filterClause = filter
      ? buildFilterClause(filter, USER_TABLE_ROWS_SQL_NAME, table.schema.columns)
      : undefined
    const excluded = new Set(excludeRowIds ?? [])

    // Resume the persisted count: a retried attempt's earlier batches are already committed,
    // so starting at zero would overwrite cumulative progress with this attempt's smaller
    // number. Doubles as the initial ownership gate.
    const resumed = await getJobProgress(tableId, jobId)
    if (resumed === null) throw new JobSupersededError()

    let processed = resumed
    let lastReported = resumed
    let afterId: string | undefined

    while (processed < budget) {
      // Ownership gate before every page: once this run loses the table (cancel/supersede),
      // updateJobProgress returns false and we stop before deleting further.
      const owns = await updateJobProgress(tableId, processed, jobId)
      if (!owns) throw new JobSupersededError()

      const page = await selectRowIdPage({
        tableId,
        workspaceId,
        cutoff,
        filterClause,
        afterId,
        limit: Math.min(TABLE_LIMITS.DELETE_PAGE_SIZE, budget - processed),
      })
      if (page.length === 0) break
      // Advance the keyset cursor past the whole page — excluded ids are skipped (not deleted),
      // so the cursor must move even when nothing in the page is deletable.
      afterId = page[page.length - 1]

      const toDelete = excluded.size > 0 ? page.filter((id) => !excluded.has(id)) : page
      if (toDelete.length > 0) {
        processed += await deletePageByIds(tableId, workspaceId, toDelete)
      }

      if (
        processed - lastReported >= PROGRESS_INTERVAL_ROWS ||
        (lastReported === 0 && processed > 0)
      ) {
        lastReported = processed
        void appendTableEvent({
          kind: 'job',
          type: 'delete',
          tableId,
          jobId,
          status: 'running',
          progress: processed,
        })
      }
    }

    await updateJobProgress(tableId, processed, jobId)
    // Only announce success if we still won the transition — a cancel/supersede at the very end
    // makes this a no-op, and we must not emit a false `ready`.
    const becameReady = await markJobReady(tableId, jobId)
    if (becameReady) {
      void appendTableEvent({
        kind: 'job',
        type: 'delete',
        tableId,
        jobId,
        status: 'ready',
        progress: processed,
      })
      logger.info(`[${requestId}] Delete complete`, { tableId, rows: processed })
    } else {
      logger.info(
        `[${requestId}] Delete finished but no longer owns the run (canceled/superseded)`,
        {
          tableId,
          jobId,
        }
      )
    }
  } catch (err) {
    if (err instanceof JobSupersededError) {
      logger.info(`[${requestId}] Delete superseded by a newer run; stopping`, { tableId, jobId })
      return
    }
    // Rethrow the root cause, not the wrapper: drizzle query errors embed the full SQL + params
    // list (tens of KB for a batch delete) in `message`, and `cause` does not survive
    // trigger.dev's serialization between the failed `run` and `onFailure` — the clean message
    // must already be the thrown error's own `message`.
    const cause = toError(err).cause
    const error = cause ? toError(cause) : toError(err)
    logger.error(`[${requestId}] Delete failed for table ${tableId}:`, error)
    throw error
  }
}

/**
 * Marks the delete job failed and emits the failed SSE event. Called once the caller gives up on
 * the run: the trigger.dev task's `onFailure` (after retries are exhausted) or the detached
 * web-container fallback (no retries). Scoped to jobId — a no-op if a newer job has taken over.
 */
export async function markTableDeleteFailed(
  tableId: string,
  jobId: string,
  error: unknown
): Promise<void> {
  const message = truncate(getErrorMessage(toError(error).cause ?? error, 'Delete failed'), 500)
  await markJobFailed(tableId, jobId, message).catch(() => {})
  void appendTableEvent({
    kind: 'job',
    type: 'delete',
    tableId,
    jobId,
    status: 'failed',
    error: message,
  })
}
