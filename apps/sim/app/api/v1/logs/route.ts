import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { v1ListLogsContract } from '@/lib/api/contracts/v1/logs'
import { parseRequest } from '@/lib/api/server'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import {
  assertLogCostQueryAllowed,
  projectCostTotal,
  projectExecutionData,
  resolveLogFieldProjection,
} from '@/lib/logs/log-projection'
import { decodePublicLogCursor, listPublicWorkflowLogs } from '@/lib/logs/public-queries'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'
import { capabilityRefusalResponse } from '@/lib/permission-groups/capability-response'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  capabilityGovernedUserId,
  checkRateLimit,
  createRateLimitResponse,
  v1ValidationErrorResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1LogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'logs')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v1ListLogsContract,
      request,
      {},
      {
        validationErrorResponse: (error) => v1ValidationErrorResponse(error, 'Invalid parameters'),
      }
    )
    if (!parsed.success) return parsed.response

    const params = parsed.data.query

    const accessError = await validateWorkspaceAccess(
      rateLimit,
      userId,
      params.workspaceId,
      'none',
      'read'
    )
    if (accessError) return accessError

    /**
     * `logs.trace_spans` and `logs.cost` are projections, not gates, which is
     * why this route declares `'none'` above and still has to withhold fields
     * here. Same helper the internal/v2 detail path uses — a hidden tab
     * withholds nothing from a caller reading the public API directly.
     */
    const projection = await resolveLogFieldProjection(
      capabilityGovernedUserId(rateLimit),
      params.workspaceId
    )

    /**
     * Project the value, then refuse the query that selects on it. `minCost` and
     * `maxCost` bisect the very total `projectCostTotal` blanks below, so
     * withholding one while answering the other is incoherent. This surface
     * orders by `startedAt` alone — it publishes no `sortBy` — so the ordering
     * half of the oracle is not reachable here.
     *
     * It runs after the workspace access check above, so the caller is a member
     * being told about their own group rather than an outsider handed an
     * organization-configuration oracle.
     *
     * The assertion throws so every surface refuses in the same words, and this
     * route builds its own responses rather than running inside a JSON route
     * builder, so the throw is caught here instead of by a shared error
     * projection. Caught narrowly on purpose — the handler's outer `catch`
     * renders a 500, and letting a 403 fall into it would report an
     * organization's policy as a Sim fault.
     */
    try {
      assertLogCostQueryAllowed({ minCost: params.minCost, maxCost: params.maxCost }, projection)
    } catch (error) {
      if (!(error instanceof PermissionGroupCapabilityError)) throw error
      return capabilityRefusalResponse(error.capability)
    }

    logger.info(`[${requestId}] Fetching logs for workspace ${params.workspaceId}`, {
      userId,
      filters: {
        workflowIds: params.workflowIds,
        triggers: params.triggers,
        level: params.level,
      },
    })

    const decodedCursor = params.cursor
      ? decodePublicLogCursor(params.cursor, params.order ?? 'desc')
      : null
    if (params.cursor && !decodedCursor) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
    }
    const cursor = decodedCursor ?? undefined

    const filters = {
      workspaceId: params.workspaceId,
      workflowIds: params.workflowIds?.split(',').filter(Boolean),
      folderIds: params.folderIds?.split(',').filter(Boolean),
      triggers: params.triggers?.split(',').filter(Boolean),
      level: params.level,
      startDate: params.startDate ? new Date(params.startDate) : undefined,
      endDate: params.endDate ? new Date(params.endDate) : undefined,
      executionId: params.executionId,
      minDurationMs: params.minDurationMs,
      maxDurationMs: params.maxDurationMs,
      minCost: params.minCost,
      maxCost: params.maxCost,
      model: params.model,
      cursor,
      order: params.order,
    }

    const { data, nextCursor } = await listPublicWorkflowLogs({
      filters,
      limit: params.limit,
      includeExecutionData: params.details === 'full',
    })

    const needsMaterialize =
      params.details === 'full' && (params.includeFinalOutput || params.includeTraceSpans)

    const buildBase = (log: (typeof data)[number]) => {
      const result: any = {
        id: log.id,
        workflowId: log.workflowId,
        executionId: log.executionId,
        deploymentVersionId: log.deploymentVersionId,
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt?.toISOString() || null,
        totalDurationMs: log.totalDurationMs,
        cost: projectCostTotal(log.costTotal, projection),
        files: log.files || null,
      }

      if (params.details === 'full') {
        result.workflow = {
          id: log.workflowId,
          name: log.workflowName || 'Deleted Workflow',
          description: log.workflowDescription,
          deleted: !log.workflowName,
        }
      }

      return result
    }

    const formattedLogs = needsMaterialize
      ? await mapWithConcurrency(data, MATERIALIZE_CONCURRENCY, async (log) => {
          const result = buildBase(log)
          if (log.executionData) {
            const materialized = (await materializeExecutionDataForDisplay(
              log.executionData as Record<string, unknown> | null,
              {
                workspaceId: log.workspaceId,
                workflowId: log.workflowId,
                executionId: log.executionId,
                userId,
              }
            )) as Record<string, unknown> | null
            const execData = projectExecutionData(materialized, projection) as any
            if (params.includeFinalOutput && execData?.finalOutput) {
              result.finalOutput = execData.finalOutput
            }
            if (params.includeTraceSpans && execData?.traceSpans) {
              result.traceSpans = execData.traceSpans
            }
          }
          return result
        })
      : data.map(buildBase)

    const limits = await getUserLimits(userId)

    const response = createApiResponse(
      {
        data: formattedLogs,
        nextCursor: nextCursor ?? undefined,
      },
      limits,
      rateLimit // This is the API endpoint rate limit, not workflow execution limits
    )

    return NextResponse.json(response.body, { headers: response.headers })
  } catch (error: any) {
    logger.error(`[${requestId}] Logs fetch error`, { error: error.message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
