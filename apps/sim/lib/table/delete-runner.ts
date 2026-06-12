import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { Filter } from '@/lib/table'
import { TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { appendTableEvent } from '@/lib/table/events'
import {
  deletePageByIds,
  getTableById,
  markJobFailed,
  markJobReady,
  selectRowIdPage,
  updateJobProgress,
} from '@/lib/table/service'
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
}

/**
 * Background worker for large filtered row deletes. Runs detached on the web container (see the
 * delete-async kickoff route). Deletes in keyset-paginated pages — `created_at <= cutoff` spares
 * rows inserted while the job runs, and `excludeRowIds` spares specific rows (the
 * "select all then deselect a few" case). Ownership-gated per page so a cancel/supersede stops
 * it within one page; committed pages are never rolled back. Progress and the terminal state are
 * surfaced via the table-events SSE stream.
 */
export async function runTableDelete(payload: TableDeletePayload): Promise<void> {
  const { jobId, tableId, workspaceId, filter, excludeRowIds, cutoff } = payload
  const requestId = generateId().slice(0, 8)

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table) throw new Error(`Delete target table ${tableId} not found`)

    const filterClause = filter
      ? buildFilterClause(filter, USER_TABLE_ROWS_SQL_NAME, table.schema.columns)
      : undefined
    const excluded = new Set(excludeRowIds ?? [])

    let processed = 0
    let lastReported = 0
    let afterId: string | undefined

    while (true) {
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
        limit: TABLE_LIMITS.DELETE_PAGE_SIZE,
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
    } else {
      const message = getErrorMessage(err, 'Delete failed')
      logger.error(`[${requestId}] Delete failed for table ${tableId}:`, err)
      // Scoped to jobId — a no-op if a newer job has taken over.
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
  }
}
