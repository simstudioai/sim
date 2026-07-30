import { db } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { type V2LogListItem, v2ListLogsContract } from '@/lib/api/contracts/v2/logs'
import { parseRequest } from '@/lib/api/server'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { buildLogFilters, getOrderBy } from '@/app/api/v1/logs/filters'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2LogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'logs')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2ListLogsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const params = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, params.workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

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
      cursor: params.cursor
        ? decodeCursor<{ startedAt: string; id: string }>(params.cursor) || undefined
        : undefined,
      order: params.order,
    }

    const conditions = buildLogFilters(filters)
    const orderBy = getOrderBy(params.order)

    const rows = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        workspaceId: workflowExecutionLogs.workspaceId,
        executionId: workflowExecutionLogs.executionId,
        deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        costTotal: workflowExecutionLogs.costTotal,
        files: workflowExecutionLogs.files,
        executionData: params.details === 'full' ? workflowExecutionLogs.executionData : sql`null`,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(conditions)
      .orderBy(...orderBy)
      .limit(params.limit + 1)

    const hasMore = rows.length > params.limit
    const data = rows.slice(0, params.limit)

    let nextCursor: string | null = null
    if (hasMore && data.length > 0) {
      const lastLog = data[data.length - 1]
      nextCursor = encodeCursor({ startedAt: lastLog.startedAt.toISOString(), id: lastLog.id })
    }

    type LogRow = (typeof data)[number]
    const buildItem = (log: LogRow): V2LogListItem => {
      const item: V2LogListItem = {
        id: log.id,
        workflowId: log.workflowId,
        executionId: log.executionId,
        deploymentVersionId: log.deploymentVersionId,
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt ? log.endedAt.toISOString() : null,
        totalDurationMs: log.totalDurationMs,
        cost: log.costTotal != null ? { total: Number(log.costTotal) } : null,
        files: (log.files as unknown[] | null) ?? null,
      }
      if (params.details === 'full') {
        item.workflow = {
          id: log.workflowId,
          name: log.workflowName || 'Deleted Workflow',
          description: log.workflowDescription,
          deleted: !log.workflowName,
        }
      }
      return item
    }

    const needsMaterialize =
      params.details === 'full' && (params.includeFinalOutput || params.includeTraceSpans)

    const formattedLogs = needsMaterialize
      ? await mapWithConcurrency(data, MATERIALIZE_CONCURRENCY, async (log) => {
          const item = buildItem(log)
          if (log.executionData) {
            const execData = (await materializeExecutionData(
              log.executionData as Record<string, unknown> | null,
              {
                workspaceId: log.workspaceId,
                workflowId: log.workflowId,
                executionId: log.executionId,
              }
            )) as Record<string, unknown>
            if (params.includeFinalOutput && execData.finalOutput) {
              item.finalOutput = execData.finalOutput
            }
            if (params.includeTraceSpans && execData.traceSpans) {
              item.traceSpans = execData.traceSpans
            }
          }
          return item
        })
      : data.map(buildItem)

    return v2CursorList(formattedLogs, nextCursor, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Logs fetch error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
