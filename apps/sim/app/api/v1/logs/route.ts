import { db } from '@sim/db'
import { permissions, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v1ListLogsContract } from '@/lib/api/contracts/v1/logs'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildLogFilters, getOrderBy } from '@/app/api/v1/logs/filters'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1LogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface CursorData {
  startedAt: string
  id: string
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

function decodeCursor(cursor: string): CursorData | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString())
  } catch {
    return null
  }
}

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
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              error: getValidationErrorMessage(error, 'Invalid parameters'),
              details: error.issues,
            },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const params = parsed.data.query

    const scopeError = checkWorkspaceScope(rateLimit, params.workspaceId)
    if (scopeError) return scopeError

    logger.info(`[${requestId}] Fetching logs for workspace ${params.workspaceId}`, {
      userId,
      filters: {
        workflowIds: params.workflowIds,
        triggers: params.triggers,
        level: params.level,
      },
    })

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
      cursor: params.cursor ? decodeCursor(params.cursor) || undefined : undefined,
      order: params.order,
    }

    const conditions = buildLogFilters(filters)
    const orderBy = getOrderBy(params.order)

    const baseQuery = db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        cost: workflowExecutionLogs.cost,
        files: workflowExecutionLogs.files,
        executionData: params.details === 'full' ? workflowExecutionLogs.executionData : sql`null`,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflowExecutionLogs.workspaceId),
          eq(permissions.userId, userId)
        )
      )

    const logs = await baseQuery
      .where(conditions)
      .orderBy(orderBy)
      .limit(params.limit + 1)

    const hasMore = logs.length > params.limit
    const data = logs.slice(0, params.limit)

    let nextCursor: string | undefined
    if (hasMore && data.length > 0) {
      const lastLog = data[data.length - 1]
      nextCursor = encodeCursor({
        startedAt: lastLog.startedAt.toISOString(),
        id: lastLog.id,
      })
    }

    const formattedLogs = data.map((log) => {
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
        cost: log.cost ? { total: (log.cost as any).total } : null,
        files: log.files || null,
      }

      if (params.details === 'full') {
        result.workflow = {
          id: log.workflowId,
          name: log.workflowName || 'Deleted Workflow',
          description: log.workflowDescription,
          deleted: !log.workflowName,
        }

        if (log.cost) {
          result.cost = log.cost
        }

        if (log.executionData) {
          const execData = log.executionData as any
          if (params.includeFinalOutput && execData.finalOutput) {
            result.finalOutput = execData.finalOutput
          }
          if (params.includeTraceSpans && execData.traceSpans) {
            result.traceSpans = execData.traceSpans
          }
        }
      }

      return result
    })

    const limits = await getUserLimits(userId)

    const response = createApiResponse(
      {
        data: formattedLogs,
        nextCursor,
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
