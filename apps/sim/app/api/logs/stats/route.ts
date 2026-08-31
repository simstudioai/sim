import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { type DashboardStatsResponse, statsQueryParamsSchema } from '@/lib/api/contracts/logs'
import { isZodError } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildFilterConditions } from '@/lib/logs/filters'
import { expandFolderIdsWithDescendants } from '@/lib/logs/folder-expansion'
import { logQuerySelectsCost } from '@/lib/logs/log-projection'
import { buildDashboardStats, resolveLogStatsWindow } from '@/lib/logs/stats'
import { readLogStatsBounds, readLogStatsSegments } from '@/lib/logs/stats-queries'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { capabilityRefusalResponse } from '@/lib/permission-groups/capability-response'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('LogsStatsAPI')

export const revalidate = 0

/**
 * Session-authenticated dashboard stats.
 *
 * The read itself lives in `lib/logs/stats-queries.ts` and the aggregation in
 * `lib/logs/stats.ts`, both shared with the public `GET /api/v2/logs/stats`.
 * The authorization does not: this route answers a caller without workspace
 * access with a zeroed 200, where v2 conceals the workspace as a 404. Migrating
 * this route to the shared use case would change that, so it keeps its legacy
 * check and consumes only the surface-neutral halves.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized logs stats access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      const { searchParams } = new URL(request.url)
      const params = statsQueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

      const access = await checkWorkspaceAccess(params.workspaceId, userId)
      if (!access.hasAccess) {
        return NextResponse.json(
          {
            workflows: [],
            aggregateSegments: [],
            totalRuns: 0,
            totalErrors: 0,
            avgLatency: 0,
            timeBounds: { start: new Date().toISOString(), end: new Date().toISOString() },
            segmentMs: 0,
          } satisfies DashboardStatsResponse,
          { status: 200 }
        )
      }

      /**
       * permission-group-enforced: logs.cost — this response carries no spend at
       * all, but `costOperator`/`costValue` reach the same indexed column the
       * list filters on, and the run counts it answers with are a bisection
       * oracle over exactly the figure the group withholds. Refused rather than
       * ignored, for the reason given on {@link assertLogCostQueryAllowed}; the
       * workspace access check above has already passed, so the caller is a
       * member learning about their own group.
       */
      const hideCostInfo = await isWorkspaceCapabilityWithheld(
        userId,
        params.workspaceId,
        'logs.cost'
      )
      if (hideCostInfo && logQuerySelectsCost(params)) {
        return capabilityRefusalResponse('logs.cost')
      }

      const workspaceFilter = eq(workflowExecutionLogs.workspaceId, params.workspaceId)

      if (params.folderIds) {
        params.folderIds = await expandFolderIdsWithDescendants(
          params.workspaceId,
          params.folderIds
        )
      }

      const commonFilters = buildFilterConditions(params, { useSimpleLevelFilter: true })
      const whereCondition = commonFilters ? and(workspaceFilter, commonFilters) : workspaceFilter

      const bounds = await readLogStatsBounds(whereCondition)
      const window = resolveLogStatsWindow(bounds, params.segmentCount, {
        requestedStart: params.startDate ? new Date(params.startDate) : undefined,
        requestedEnd: params.endDate ? new Date(params.endDate) : undefined,
      })
      const rows = await readLogStatsSegments(
        whereCondition,
        window.startTime.toISOString(),
        window.segmentMs
      )
      const { stats } = buildDashboardStats(rows, window, params.segmentCount)

      return NextResponse.json(stats, { status: 200 })
    } catch (validationError) {
      if (isZodError(validationError)) {
        logger.warn(`[${requestId}] Invalid logs stats request parameters`, {
          errors: validationError.issues,
        })
        return NextResponse.json(
          {
            error: 'Invalid request parameters',
            details: validationError.issues,
          },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error(`[${requestId}] logs stats fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
})
