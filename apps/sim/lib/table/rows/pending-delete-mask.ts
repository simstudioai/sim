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
export async function pendingDeleteMask(table: TableDefinition): Promise<SQL | undefined> {
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
