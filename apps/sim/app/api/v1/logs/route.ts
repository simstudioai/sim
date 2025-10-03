import { db } from '@sim/db'
import { permissions, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { buildLogFilters, getOrderBy } from '@/app/api/v1/logs/filters'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1LogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const QueryParamsSchema = z.object({
  workspaceId: z.string(),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
  level: z.enum(['info', 'error']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  executionId: z.string().optional(),
  minDurationMs: z.coerce.number().optional(),
  maxDurationMs: z.coerce.number().optional(),
  minCost: z.coerce.number().optional(),
  maxCost: z.coerce.number().optional(),
  model: z.string().optional(),
  details: z.enum(['basic', 'full']).optional().default('basic'),
  includeTraceSpans: z.coerce.boolean().optional().default(false),
  includeFinalOutput: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().optional().default(100),
  cursor: z.string().optional(),
  order: z.enum(['desc', 'asc']).optional().default('desc'),
})

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

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'logs')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { searchParams } = new URL(request.url)
    const rawParams = Object.fromEntries(searchParams.entries())

    const validationResult = QueryParamsSchema.safeParse(rawParams)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const params = validationResult.data

    logger.info(`[${requestId}] Fetching logs for workspace ${params.workspaceId}`, {
      userId,
      filters: {
        workflowIds: params.workflowIds,
        triggers: params.triggers,
        level: params.level,
      },
    })

    // Build filter conditions
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

    // Build and execute query
    const baseQuery = db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
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
      .innerJoin(
        workflow,
        and(
          eq(workflowExecutionLogs.workflowId, workflow.id),
          eq(workflow.workspaceId, params.workspaceId)
        )
      )
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, params.workspaceId),
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
          name: log.workflowName,
          description: log.workflowDescription,
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

    // Get user's workflow execution limits and usage
    const limits = await getUserLimits(userId)

    // Create response with limits information
    // The rateLimit object from checkRateLimit is for THIS API endpoint's rate limits
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
}
