import { db } from '@sim/db'
import { tableJobs, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, lte, notInArray, type SQL, sql } from 'drizzle-orm'
import { USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { buildFilterClause } from '@/lib/table/sql'
import type { TableDefinition, TableDeleteJobPayload } from '@/lib/table/types'

const logger = createLogger('TablePendingDeleteMask')

/**
 * Whether {@link PendingDeleteMaskOptions.trustLoadedJob} can rule a running delete job out.
 *
 * Every table loaded through `getTableById` / `listTables` already carries its latest non-export
 * job, folded into that same SELECT as a lateral, so a caller that loaded its table for this very
 * read already holds the answer and the lookup is pure overhead on the hot path.
 *
 * The derivation is exact, not a heuristic. `table_jobs_one_active_per_table` is unique on
 * `table_id WHERE status = 'running' AND type <> 'export'` — the same predicate the lateral
 * filters on — so a running delete job is the ONLY running non-export job on its table, and no
 * further non-export job can be inserted while it holds that slot. It is therefore the newest
 * non-export job by `started_at`, which is exactly the row the lateral returns.
 *
 * `jobStatus === undefined` means the fields were never hydrated (a `TableDefinition` assembled
 * by some other path), which is indistinguishable from "no job" in the shape alone — so that case
 * falls back to the query rather than assuming. A hydrated table with no job has
 * `jobStatus: null`.
 */
function hydratedJobRulesOutDelete(table: TableDefinition): boolean {
  if (table.jobStatus === undefined) return false
  return !(table.jobStatus === 'running' && table.jobType === 'delete')
}

export interface PendingDeleteMaskOptions {
  /**
   * Answer from `table`'s own latest-job fields when they rule a running delete out, instead of
   * querying for one.
   *
   * Only for a caller whose `table` was loaded for this read: the fields are then as fresh as the
   * query would have been. A caller that loads a table once and then pages for a while — the
   * export runner, the snapshot builder — must NOT set this, because a delete job starting
   * mid-walk would never appear in its snapshot and its later pages would stop masking doomed
   * rows. Those callers keep re-asking per page, which is what makes the mask appear mid-walk.
   */
  trustLoadedJob?: boolean
}

/**
 * Visibility mask for a running delete job: returns a clause keeping only rows the job will NOT
 * delete, or `undefined` when no delete job is running. The job's persisted scope
 * ({@link TableDeleteJobPayload}) defines the doomed set — `matches(filter) AND created_at <=
 * cutoff AND id NOT IN excludeRowIds` — exactly what the worker's `selectRowIdPage` selects, so
 * mid-job reads (refresh, other clients, exports) are consistent with the eventual result. The
 * mask lifts automatically when the job leaves `running` (done, failed, or canceled).
 *
 * `(doomed) IS NOT TRUE` rather than `NOT (doomed)`: JSONB predicates evaluate to NULL on missing
 * cells, and those rows are NOT selected for deletion (NULL ≠ TRUE) — they must stay visible.
 */
export async function pendingDeleteMask(
  table: TableDefinition,
  options?: PendingDeleteMaskOptions
): Promise<SQL | undefined> {
  if (options?.trustLoadedJob && hydratedJobRulesOutDelete(table)) return undefined
  const [job] = await db
    .select({ payload: tableJobs.payload })
    .from(tableJobs)
    .where(
      and(
        eq(tableJobs.tableId, table.id),
        eq(tableJobs.status, 'running'),
        eq(tableJobs.type, 'delete')
      )
    )
    .limit(1)
  if (!job?.payload) return undefined
  const scope = job.payload as TableDeleteJobPayload

  // A bounded delete (explicit limit) deletes only the first `maxRows` matches, so the filter-based
  // mask — which hides every match — would over-hide the rows beyond the cap this job never touches.
  // Leave those reads unmasked; the bounded delete is eventually consistent like a bounded update.
  if (scope.maxRows !== undefined) return undefined

  const doomedParts: SQL[] = []
  if (scope.filter && Object.keys(scope.filter).length > 0) {
    try {
      const clause = buildFilterClause(scope.filter, USER_TABLE_ROWS_SQL_NAME, table.schema.columns)
      if (clause) doomedParts.push(clause)
    } catch (error) {
      // Schema drifted mid-job (column renamed/deleted). Showing doomed rows briefly beats
      // failing every read; the worker resolves the same way on its next page.
      logger.warn(`Skipping delete-job mask for table ${table.id}: stale filter`, {
        error: toError(error).message,
      })
      return undefined
    }
  }
  if (scope.cutoff) doomedParts.push(lte(userTableRows.createdAt, new Date(scope.cutoff)))
  if (scope.excludeRowIds && scope.excludeRowIds.length > 0) {
    doomedParts.push(notInArray(userTableRows.id, scope.excludeRowIds))
  }
  if (doomedParts.length === 0) return undefined
  return sql`(${and(...doomedParts)}) IS NOT TRUE`
}
