import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { v1GetLogContract } from '@/lib/api/contracts/v1/logs'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import {
  projectCostTotal,
  projectExecutionData,
  resolveLogFieldProjection,
} from '@/lib/logs/log-projection'
import { getPublicWorkflowLog } from '@/lib/logs/public-queries'
import { createApiResponse, getUserLimits, projectUserLimits } from '@/app/api/v1/logs/meta'
import {
  capabilityGovernedUserId,
  checkRateLimit,
  concealedWorkspaceAccessResponse,
  createRateLimitResponse,
  resolveWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1LogDetailsAPI')

export const revalidate = 0

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'logs-detail')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1GetLogContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid log ID' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const log = await getPublicWorkflowLog({ column: 'id', value: id })
      if (!log) {
        return NextResponse.json({ error: 'Log not found' }, { status: 404 })
      }

      const accessError = await resolveWorkspaceAccess(rateLimit, userId, log.workspaceId, 'none')
      if (accessError) {
        return concealedWorkspaceAccessResponse(accessError, 'Log not found')
      }

      /**
       * `logs.trace_spans` and `logs.cost` are projections, not gates — this
       * route declares `'none'` above and withholds the fields here instead,
       * through the same helper the internal/v2 detail path uses.
       */
      const projection = await resolveLogFieldProjection(
        capabilityGovernedUserId(rateLimit),
        log.workspaceId
      )

      const workflowSummary = {
        id: log.workflowId,
        name: log.workflowName || 'Deleted Workflow',
        description: log.workflowDescription,
        folderId: log.workflowFolderId,
        workspaceId: log.workflowWorkspaceId,
        createdAt: log.workflowCreatedAt,
        updatedAt: log.workflowUpdatedAt,
        deleted: !log.workflowName,
      }

      const response = {
        id: log.id,
        workflowId: log.workflowId,
        executionId: log.executionId,
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt?.toISOString() || null,
        totalDurationMs: log.totalDurationMs,
        files: log.files || undefined,
        workflow: workflowSummary,
        executionData: projectExecutionData(
          (await materializeExecutionDataForDisplay(
            log.executionData as Record<string, unknown> | null,
            {
              workspaceId: log.workspaceId,
              workflowId: log.workflowId,
              executionId: log.executionId,
              userId,
            }
          )) as Record<string, unknown> | null,
          projection
        ) as any,
        cost: projectCostTotal(log.costTotal, projection),
        createdAt: log.createdAt.toISOString(),
      }

      // Get user's workflow execution limits and usage
      const limits = projectUserLimits(await getUserLimits(userId), projection)

      // Create response with limits information
      const apiResponse = createApiResponse({ data: response }, limits, rateLimit)

      return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
    } catch (error: any) {
      logger.error(`[${requestId}] Log details fetch error`, { error: error.message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
