import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteTableRowsAsyncContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { runTableDelete } from '@/lib/table/delete-runner'
import { markTableJobRunning } from '@/lib/table/service'
import { buildFilterClause, TableQueryValidationError } from '@/lib/table/sql'
import type { Filter } from '@/lib/table/types'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableDeleteAsync')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/delete-async
 *
 * Kicks off a background "select all" delete: the client sends the active filter (and an optional
 * exclusion set) instead of every row id. Claims the table's single job slot (mutually exclusive
 * with imports), captures a `created_at` cutoff so rows inserted while the job runs survive, then
 * runs the paginated delete worker detached.
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const userId = authResult.userId

  const parsed = await parseRequest(deleteTableRowsAsyncContract, request, { params })
  if (!parsed.success) return parsed.response
  const { tableId } = parsed.data.params
  const { workspaceId, filter, excludeRowIds } = parsed.data.body

  const access = await checkAccess(tableId, userId, 'write')
  if (!access.ok) return accessError(access, requestId, tableId)
  const { table } = access

  if (table.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
  }
  if (table.archivedAt) {
    return NextResponse.json({ error: 'Cannot delete from an archived table' }, { status: 400 })
  }

  // Validate the filter up front so the caller gets immediate feedback (the worker reuses it).
  if (filter) {
    try {
      buildFilterClause(filter as Filter, USER_TABLE_ROWS_SQL_NAME, table.schema.columns)
    } catch (error) {
      if (error instanceof TableQueryValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }
  }

  // Rows inserted after this instant are spared (created_at <= cutoff in the worker).
  const cutoff = new Date()

  // Atomically claim the job slot — one background job per table, so this also blocks while an
  // import is in flight (and vice versa).
  const jobId = generateId()
  const claimed = await markTableJobRunning(tableId, jobId, 'delete')
  if (!claimed) {
    return NextResponse.json(
      { error: 'A job is already in progress for this table' },
      { status: 409 }
    )
  }

  runDetached('table-delete', () =>
    runTableDelete({
      jobId,
      tableId,
      workspaceId,
      filter: filter as Filter | undefined,
      excludeRowIds,
      cutoff,
    })
  )

  logger.info(`[${requestId}] Async row delete started`, {
    tableId,
    jobId,
    hasFilter: Boolean(filter),
    excluded: excludeRowIds?.length ?? 0,
  })
  return NextResponse.json({ success: true, data: { tableId, jobId } })
})
