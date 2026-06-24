import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteTableRowsAsyncContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { markTableDeleteFailed, runTableDelete } from '@/lib/table/delete-runner'
import { markTableJobRunning, releaseJobClaim } from '@/lib/table/jobs/service'
import type { TableDeleteJobPayload } from '@/lib/table/types'
import { accessError, checkAccess, tableFilterError } from '@/app/api/table/utils'

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
  const { workspaceId, filter, excludeRowIds, estimatedCount } = parsed.data.body

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
  const filterError = tableFilterError(filter, table.schema.columns)
  if (filterError) return filterError

  // Rows inserted after this instant are spared (created_at <= cutoff in the worker).
  const cutoff = new Date()

  // Atomically claim the job slot — one background job per table, so this also blocks while an
  // import is in flight (and vice versa). The scope is persisted to the job's payload so read
  // paths can mask the doomed rows while the job runs (see `pendingDeleteMask`).
  const jobId = generateId()
  const payload: TableDeleteJobPayload = {
    filter,
    excludeRowIds,
    cutoff: cutoff.toISOString(),
    // Clamp the client's display estimate to reality so a stale/bogus value
    // can't drive counts negative or hide more than the table holds.
    ...(estimatedCount != null ? { doomedCount: Math.min(estimatedCount, table.rowCount) } : {}),
  }
  const claimed = await markTableJobRunning(tableId, jobId, 'delete', payload)
  if (!claimed) {
    return NextResponse.json(
      { error: 'A job is already in progress for this table' },
      { status: 409 }
    )
  }

  if (isTriggerDevEnabled) {
    // Trigger.dev runs the delete outside the web container (survives deploys) and retries —
    // safe: the keyset + cutoff walk just deletes whatever remains.
    try {
      const [{ tableDeleteTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-delete'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableDeleteTask>(
        'table-delete',
        { jobId, tableId, workspaceId, filter, excludeRowIds, cutoff: cutoff.toISOString() },
        { tags: [`tableId:${tableId}`, `jobId:${jobId}`], region: await resolveTriggerRegion() }
      )
    } catch (error) {
      // A failed dispatch must not leave a ghost `running` job holding the
      // table's one-write-job slot until the stale-job janitor fires.
      await releaseJobClaim(tableId, jobId).catch(() => {})
      throw error
    }
  } else {
    runDetached('table-delete', () =>
      runTableDelete({
        jobId,
        tableId,
        workspaceId,
        filter,
        excludeRowIds,
        cutoff,
      }).catch(async (error) => {
        // No retry machinery on the detached path — fail the job immediately.
        await markTableDeleteFailed(tableId, jobId, error)
        throw error
      })
    )
  }

  logger.info(`[${requestId}] Async row delete started`, {
    tableId,
    jobId,
    hasFilter: Boolean(filter),
    excluded: excludeRowIds?.length ?? 0,
  })
  return NextResponse.json({ success: true, data: { tableId, jobId } })
})
