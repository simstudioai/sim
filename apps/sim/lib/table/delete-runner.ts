import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import type { Filter, TableDefinition } from '@/lib/table'
import { TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { appendTableEvent, signalTableRowsChanged } from '@/lib/table/events'
import {
  getJobProgress,
  markJobCanceled,
  markJobFailed,
  markJobReady,
  updateJobProgress,
} from '@/lib/table/jobs/service'
import { assertRowDelete, type MutationProof, TableLockedError } from '@/lib/table/mutation-locks'
import type { DbTransaction } from '@/lib/table/planner'
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

  // Whether any row was actually deleted this run. Signalled in `finally` so open editors refetch the
  // grid on EVERY exit path — normal completion, a cancel/supersede between batches, a mid-batch lock,
  // or a rethrown error after a partial delete — not only the throttled/`ready` paths (which a cancel
  // landing after a committed batch would bypass, leaving deleted rows on screen).
  let deletedAny = false

  try {
    const table = await getTableById(tableId, { includeArchived: true })
    if (!table) throw new Error(`Delete target table ${tableId} not found`)

    // Gate the run on the delete lock, then re-gate it before every page (see
    // the loop below) so enabling the lock mid-job stops the deletion rather
    // than merely preventing the next one. Returning rather than throwing
    // releases the job slot without burning this task's remaining
    // `maxAttempts` on a deterministic failure.
    const cancelForLock = async (processedSoFar: number): Promise<void> => {
      logger.info(`[${requestId}] Delete job stopped — table is delete-locked`, {
        tableId,
        jobId,
        processedSoFar,
      })
      await markJobCanceled(tableId, jobId)
      void appendTableEvent({ kind: 'job', type: 'delete', tableId, jobId, status: 'canceled' })
    }

    const stopIfLocked = async (
      fresh: TableDefinition,
      processedSoFar: number
    ): Promise<MutationProof<'delete'> | null> => {
      try {
        return assertRowDelete(fresh)
      } catch (err) {
        if (!(err instanceof TableLockedError)) throw err
        await cancelForLock(processedSoFar)
        return null
      }
    }

    if ((await stopIfLocked(table, 0)) === null) return

    // Runs inside each batch's transaction, under the same advisory lock the
    // lock toggle holds, so no page can be written after a lock commits.
    const revalidate = async (trx: DbTransaction) => {
      const fresh = await getTableById(tableId, { tx: trx, includeArchived: true })
      if (fresh) assertRowDelete(fresh)
      return fresh ?? undefined
    }

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

      // Cheap early-out before selecting a page we may not be allowed to
      // write. The authoritative gate is `revalidate` below, which re-asserts
      // inside each batch transaction; this read only avoids the wasted page
      // fetch. Pages already committed stay committed — the same contract as
      // an explicit cancel.
      const current = await getTableById(tableId, { includeArchived: true })
      if (!current) throw new JobSupersededError()
      const pageProof = await stopIfLocked(current, processed)
      if (pageProof === null) return

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
        try {
          const deleted = await deletePageByIds(
            tableId,
            workspaceId,
            toDelete,
            pageProof,
            revalidate
          )
          processed += deleted
          if (deleted > 0) deletedAny = true
        } catch (err) {
          if (!(err instanceof TableLockedError)) throw err
          // A lock landed between batches. Batches already committed stay
          // deleted; `processed` undercounts them, which only affects the
          // final progress number on an already-canceled job.
          await cancelForLock(processed)
          return
        }
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
        // Refetch the live grid as rows drop out (throttled with the progress event above) — the `job`
        // event only drives the progress meter, not the rows query. The `finally` below guarantees a
        // final refetch on every exit, so a cancel after the last un-throttled batch can't leave stale rows.
        signalTableRowsChanged(tableId)
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
  } finally {
    // Guaranteed final grid refetch on every exit — completion, cancel/supersede, mid-batch lock, or a
    // rethrown error — whenever this run deleted anything, so no open editor keeps showing deleted rows.
    if (deletedAny) signalTableRowsChanged(tableId)
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
