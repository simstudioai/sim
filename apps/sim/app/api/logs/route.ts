import { db } from '@sim/db'
import { permissions, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('LogsAPI')

export const revalidate = 0

const QueryParamsSchema = z.object({
  details: z.enum(['basic', 'full']).optional().default('basic'),
  limit: z.coerce.number().optional().default(100),
  offset: z.coerce.number().optional().default(0),
  level: z.string().optional(),
  workflowIds: z.string().optional(), // Comma-separated list of workflow IDs
  folderIds: z.string().optional(), // Comma-separated list of folder IDs
  triggers: z.string().optional(), // Comma-separated list of trigger types
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  workflowName: z.string().optional(),
  folderName: z.string().optional(),
  workspaceId: z.string(),
})

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized logs access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      const { searchParams } = new URL(request.url)
      const params = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

      // Conditionally select columns based on detail level to optimize performance
      const selectColumns =
        params.details === 'full'
          ? {
              id: workflowExecutionLogs.id,
              workflowId: workflowExecutionLogs.workflowId,
              executionId: workflowExecutionLogs.executionId,
              stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
              level: workflowExecutionLogs.level,
              trigger: workflowExecutionLogs.trigger,
              startedAt: workflowExecutionLogs.startedAt,
              endedAt: workflowExecutionLogs.endedAt,
              totalDurationMs: workflowExecutionLogs.totalDurationMs,
              executionData: workflowExecutionLogs.executionData, // Large field - only in full mode
              cost: workflowExecutionLogs.cost,
              files: workflowExecutionLogs.files, // Large field - only in full mode
              createdAt: workflowExecutionLogs.createdAt,
              workflowName: workflow.name,
              workflowDescription: workflow.description,
              workflowColor: workflow.color,
              workflowFolderId: workflow.folderId,
              workflowUserId: workflow.userId,
              workflowWorkspaceId: workflow.workspaceId,
              workflowCreatedAt: workflow.createdAt,
              workflowUpdatedAt: workflow.updatedAt,
            }
          : {
              // Basic mode - exclude large fields for better performance
              id: workflowExecutionLogs.id,
              workflowId: workflowExecutionLogs.workflowId,
              executionId: workflowExecutionLogs.executionId,
              stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
              level: workflowExecutionLogs.level,
              trigger: workflowExecutionLogs.trigger,
              startedAt: workflowExecutionLogs.startedAt,
              endedAt: workflowExecutionLogs.endedAt,
              totalDurationMs: workflowExecutionLogs.totalDurationMs,
              executionData: sql<null>`NULL`, // Exclude large execution data in basic mode
              cost: workflowExecutionLogs.cost,
              files: sql<null>`NULL`, // Exclude files in basic mode
              createdAt: workflowExecutionLogs.createdAt,
              workflowName: workflow.name,
              workflowDescription: workflow.description,
              workflowColor: workflow.color,
              workflowFolderId: workflow.folderId,
              workflowUserId: workflow.userId,
              workflowWorkspaceId: workflow.workspaceId,
              workflowCreatedAt: workflow.createdAt,
              workflowUpdatedAt: workflow.updatedAt,
            }

      const baseQuery = db
        .select(selectColumns)
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
            eq(permissions.entityId, workflow.workspaceId),
            eq(permissions.userId, userId)
          )
        )

      // Build additional conditions for the query
      let conditions: SQL | undefined

      // Filter by level
      if (params.level && params.level !== 'all') {
        conditions = and(conditions, eq(workflowExecutionLogs.level, params.level))
      }

      // Filter by specific workflow IDs
      if (params.workflowIds) {
        const workflowIds = params.workflowIds.split(',').filter(Boolean)
        if (workflowIds.length > 0) {
          conditions = and(conditions, inArray(workflow.id, workflowIds))
        }
      }

      // Filter by folder IDs
      if (params.folderIds) {
        const folderIds = params.folderIds.split(',').filter(Boolean)
        if (folderIds.length > 0) {
          conditions = and(conditions, inArray(workflow.folderId, folderIds))
        }
      }

      // Filter by triggers
      if (params.triggers) {
        const triggers = params.triggers.split(',').filter(Boolean)
        if (triggers.length > 0 && !triggers.includes('all')) {
          conditions = and(conditions, inArray(workflowExecutionLogs.trigger, triggers))
        }
      }

      // Filter by date range
      if (params.startDate) {
        conditions = and(
          conditions,
          gte(workflowExecutionLogs.startedAt, new Date(params.startDate))
        )
      }
      if (params.endDate) {
        conditions = and(conditions, lte(workflowExecutionLogs.startedAt, new Date(params.endDate)))
      }

      // Filter by search query
      if (params.search) {
        const searchTerm = `%${params.search}%`
        // With message removed, restrict search to executionId only
        conditions = and(conditions, sql`${workflowExecutionLogs.executionId} ILIKE ${searchTerm}`)
      }

      // Filter by workflow name (from advanced search input)
      if (params.workflowName) {
        const nameTerm = `%${params.workflowName}%`
        conditions = and(conditions, sql`${workflow.name} ILIKE ${nameTerm}`)
      }

      // Filter by folder name (best-effort text match when present on workflows)
      if (params.folderName) {
        const folderTerm = `%${params.folderName}%`
        conditions = and(conditions, sql`${workflow.name} ILIKE ${folderTerm}`)
      }

      // Execute the query using the optimized join
      const logs = await baseQuery
        .where(conditions)
        .orderBy(desc(workflowExecutionLogs.startedAt))
        .limit(params.limit)
        .offset(params.offset)

      // Get total count for pagination using the same join structure
      const countQuery = db
        .select({ count: sql<number>`count(*)` })
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
            eq(permissions.entityId, workflow.workspaceId),
            eq(permissions.userId, userId)
          )
        )
        .where(conditions)

      const countResult = await countQuery

      const count = countResult[0]?.count || 0

      // Block executions are now extracted from trace spans instead of separate table
      const blockExecutionsByExecution: Record<string, any[]> = {}

      // Create clean trace spans from block executions
      const createTraceSpans = (blockExecutions: any[]) => {
        return blockExecutions.map((block, index) => {
          // For error blocks, include error information in the output
          let output = block.outputData
          if (block.status === 'error' && block.errorMessage) {
            output = {
              ...output,
              error: block.errorMessage,
              stackTrace: block.errorStackTrace,
            }
          }

          return {
            id: block.id,
            name: `Block ${block.blockName || block.blockType} (${block.blockType})`,
            type: block.blockType,
            duration: block.durationMs,
            startTime: block.startedAt,
            endTime: block.endedAt,
            status: block.status === 'success' ? 'success' : 'error',
            blockId: block.blockId,
            input: block.inputData,
            output,
            tokens: block.cost?.tokens?.total || 0,
            relativeStartMs: index * 100,
            children: [],
            toolCalls: [],
          }
        })
      }

      // Extract cost information from block executions
      const extractCostSummary = (blockExecutions: any[]) => {
        let totalCost = 0
        let totalInputCost = 0
        let totalOutputCost = 0
        let totalTokens = 0
        let totalPromptTokens = 0
        let totalCompletionTokens = 0
        const models = new Map()

        blockExecutions.forEach((block) => {
          if (block.cost) {
            totalCost += Number(block.cost.total) || 0
            totalInputCost += Number(block.cost.input) || 0
            totalOutputCost += Number(block.cost.output) || 0
            totalTokens += block.cost.tokens?.total || 0
            totalPromptTokens += block.cost.tokens?.prompt || 0
            totalCompletionTokens += block.cost.tokens?.completion || 0

            // Track per-model costs
            if (block.cost.model) {
              if (!models.has(block.cost.model)) {
                models.set(block.cost.model, {
                  input: 0,
                  output: 0,
                  total: 0,
                  tokens: { prompt: 0, completion: 0, total: 0 },
                })
              }
              const modelCost = models.get(block.cost.model)
              modelCost.input += Number(block.cost.input) || 0
              modelCost.output += Number(block.cost.output) || 0
              modelCost.total += Number(block.cost.total) || 0
              modelCost.tokens.prompt += block.cost.tokens?.prompt || 0
              modelCost.tokens.completion += block.cost.tokens?.completion || 0
              modelCost.tokens.total += block.cost.tokens?.total || 0
            }
          }
        })

        return {
          total: totalCost,
          input: totalInputCost,
          output: totalOutputCost,
          tokens: {
            total: totalTokens,
            prompt: totalPromptTokens,
            completion: totalCompletionTokens,
          },
          models: Object.fromEntries(models), // Convert Map to object for JSON serialization
        }
      }

      // Transform to clean log format with workflow data included
      const enhancedLogs = logs.map((log) => {
        const blockExecutions = blockExecutionsByExecution[log.executionId] || []

        // Only process trace spans and detailed cost in full mode
        let traceSpans = []
        let costSummary = (log.cost as any) || { total: 0 }

        if (params.details === 'full' && log.executionData) {
          // Use stored trace spans if available, otherwise create from block executions
          const storedTraceSpans = (log.executionData as any)?.traceSpans
          traceSpans =
            storedTraceSpans && Array.isArray(storedTraceSpans) && storedTraceSpans.length > 0
              ? storedTraceSpans
              : createTraceSpans(blockExecutions)

          // Prefer stored cost JSON; otherwise synthesize from blocks
          costSummary =
            log.cost && Object.keys(log.cost as any).length > 0
              ? (log.cost as any)
              : extractCostSummary(blockExecutions)
        }

        const workflowSummary = {
          id: log.workflowId,
          name: log.workflowName,
          description: log.workflowDescription,
          color: log.workflowColor,
          folderId: log.workflowFolderId,
          userId: log.workflowUserId,
          workspaceId: log.workflowWorkspaceId,
          createdAt: log.workflowCreatedAt,
          updatedAt: log.workflowUpdatedAt,
        }

        return {
          id: log.id,
          workflowId: log.workflowId,
          executionId: params.details === 'full' ? log.executionId : undefined,
          level: log.level,
          duration: log.totalDurationMs ? `${log.totalDurationMs}ms` : null,
          trigger: log.trigger,
          createdAt: log.startedAt.toISOString(),
          files: params.details === 'full' ? log.files || undefined : undefined,
          workflow: workflowSummary,
          executionData:
            params.details === 'full'
              ? {
                  totalDuration: log.totalDurationMs,
                  traceSpans,
                  blockExecutions,
                  enhanced: true,
                }
              : undefined,
          cost:
            params.details === 'full'
              ? (costSummary as any)
              : { total: (costSummary as any)?.total || 0 },
        }
      })
      return NextResponse.json(
        {
          data: enhancedLogs,
          total: Number(count),
          page: Math.floor(params.offset / params.limit) + 1,
          pageSize: params.limit,
          totalPages: Math.ceil(Number(count) / params.limit),
        },
        { status: 200 }
      )
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid logs request parameters`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          {
            error: 'Invalid request parameters',
            details: validationError.errors,
          },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error(`[${requestId}] logs fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
