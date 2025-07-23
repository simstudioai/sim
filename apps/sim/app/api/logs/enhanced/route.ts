import { and, desc, eq, gte, inArray, lte, or, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { permissions, workflow, workflowExecutionBlocks, workflowExecutionLogs } from '@/db/schema'

const logger = createLogger('EnhancedLogsAPI')

// Helper function to extract block executions from trace spans
function extractBlockExecutionsFromTraceSpans(traceSpans: any[]): any[] {
  const blockExecutions: any[] = []

  function processSpan(span: any) {
    if (span.blockId) {
      blockExecutions.push({
        id: span.id,
        blockId: span.blockId,
        blockName: span.name || '',
        blockType: span.type,
        startedAt: span.startTime,
        endedAt: span.endTime,
        durationMs: span.duration || 0,
        status: span.status || 'success',
        errorMessage: span.output?.error || undefined,
        inputData: span.input || {},
        outputData: span.output || {},
        cost: span.cost || undefined,
        metadata: {},
      })
    }

    // Process children recursively
    if (span.children && Array.isArray(span.children)) {
      span.children.forEach(processSpan)
    }
  }

  traceSpans.forEach(processSpan)
  return blockExecutions
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

const QueryParamsSchema = z.object({
  includeWorkflow: z.coerce.boolean().optional().default(false),
  includeBlocks: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().optional().default(100),
  offset: z.coerce.number().optional().default(0),
  level: z.string().optional(),
  workflowIds: z.string().optional(), // Comma-separated list of workflow IDs
  folderIds: z.string().optional(), // Comma-separated list of folder IDs
  triggers: z.string().optional(), // Comma-separated list of trigger types
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
})

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized enhanced logs access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      const { searchParams } = new URL(request.url)
      const params = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

      // Get workflows that user can access through direct ownership OR workspace permissions
      const userWorkflows = await db
        .select({ id: workflow.id, folderId: workflow.folderId })
        .from(workflow)
        .leftJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflow.workspaceId),
            eq(permissions.userId, userId)
          )
        )
        .where(
          or(
            eq(workflow.userId, userId),
            and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace'))
          )
        )

      const userWorkflowIds = userWorkflows.map((w) => w.id)

      if (userWorkflowIds.length === 0) {
        return NextResponse.json({ data: [], total: 0 }, { status: 200 })
      }

      // Build conditions for enhanced logs
      let conditions: SQL | undefined = inArray(workflowExecutionLogs.workflowId, userWorkflowIds)

      // Filter by level
      if (params.level && params.level !== 'all') {
        conditions = and(conditions, eq(workflowExecutionLogs.level, params.level))
      }

      // Filter by specific workflow IDs
      if (params.workflowIds) {
        const workflowIds = params.workflowIds.split(',').filter(Boolean)
        const filteredWorkflowIds = workflowIds.filter((id) => userWorkflowIds.includes(id))
        if (filteredWorkflowIds.length > 0) {
          conditions = and(
            conditions,
            inArray(workflowExecutionLogs.workflowId, filteredWorkflowIds)
          )
        }
      }

      // Filter by folder IDs
      if (params.folderIds) {
        const folderIds = params.folderIds.split(',').filter(Boolean)
        const workflowsInFolders = userWorkflows
          .filter((w) => w.folderId && folderIds.includes(w.folderId))
          .map((w) => w.id)

        if (workflowsInFolders.length > 0) {
          conditions = and(
            conditions,
            inArray(workflowExecutionLogs.workflowId, workflowsInFolders)
          )
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
        conditions = and(
          conditions,
          or(
            sql`${workflowExecutionLogs.message} ILIKE ${searchTerm}`,
            sql`${workflowExecutionLogs.executionId} ILIKE ${searchTerm}`
          )
        )
      }

      // Execute the query
      const logs = await db
        .select()
        .from(workflowExecutionLogs)
        .where(conditions)
        .orderBy(desc(workflowExecutionLogs.startedAt))
        .limit(params.limit)
        .offset(params.offset)

      // Get total count for pagination
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(workflowExecutionLogs)
        .where(conditions)

      const count = countResult[0]?.count || 0

      // Get block executions for all workflow executions
      const executionIds = logs.map((log) => log.executionId)
      let blockExecutionsByExecution: Record<string, any[]> = {}

      if (executionIds.length > 0) {
        const blockLogs = await db
          .select()
          .from(workflowExecutionBlocks)
          .where(inArray(workflowExecutionBlocks.executionId, executionIds))
          .orderBy(workflowExecutionBlocks.startedAt)

        // Group block logs by execution ID
        blockExecutionsByExecution = blockLogs.reduce(
          (acc, blockLog) => {
            if (!acc[blockLog.executionId]) {
              acc[blockLog.executionId] = []
            }
            acc[blockLog.executionId].push({
              id: blockLog.id,
              blockId: blockLog.blockId,
              blockName: blockLog.blockName || '',
              blockType: blockLog.blockType,
              startedAt: blockLog.startedAt.toISOString(),
              endedAt: blockLog.endedAt?.toISOString() || blockLog.startedAt.toISOString(),
              durationMs: blockLog.durationMs || 0,
              status: blockLog.status,
              errorMessage: blockLog.errorMessage || undefined,
              errorStackTrace: blockLog.errorStackTrace || undefined,
              inputData: blockLog.inputData,
              outputData: blockLog.outputData,
              cost: blockLog.costTotal
                ? {
                    input: Number(blockLog.costInput) || 0,
                    output: Number(blockLog.costOutput) || 0,
                    total: Number(blockLog.costTotal) || 0,
                    tokens: {
                      prompt: blockLog.tokensPrompt || 0,
                      completion: blockLog.tokensCompletion || 0,
                      total: blockLog.tokensTotal || 0,
                    },
                    model: blockLog.modelUsed || '',
                  }
                : undefined,
              metadata: blockLog.metadata || {},
            })
            return acc
          },
          {} as Record<string, any[]>
        )
      }

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

      // Transform to clean enhanced log format
      const enhancedLogs = logs.map((log) => {
        const blockExecutions = blockExecutionsByExecution[log.executionId] || []

        // Use stored trace spans from metadata if available, otherwise create from block executions
        const storedTraceSpans = (log.metadata as any)?.traceSpans
        const traceSpans =
          storedTraceSpans && Array.isArray(storedTraceSpans) && storedTraceSpans.length > 0
            ? storedTraceSpans
            : createTraceSpans(blockExecutions)

        // Use extracted cost summary if available, otherwise use stored values
        const costSummary =
          blockExecutions.length > 0
            ? extractCostSummary(blockExecutions)
            : {
                input: Number(log.totalInputCost) || 0,
                output: Number(log.totalOutputCost) || 0,
                total: Number(log.totalCost) || 0,
                tokens: {
                  total: log.totalTokens || 0,
                  prompt: (log.metadata as any)?.tokenBreakdown?.prompt || 0,
                  completion: (log.metadata as any)?.tokenBreakdown?.completion || 0,
                },
                models: (log.metadata as any)?.models || {},
              }

        return {
          id: log.id,
          workflowId: log.workflowId,
          executionId: log.executionId,
          level: log.level,
          message: log.message,
          duration: log.totalDurationMs ? `${log.totalDurationMs}ms` : null,
          trigger: log.trigger,
          createdAt: log.startedAt.toISOString(),
          metadata: {
            totalDuration: log.totalDurationMs,
            cost: costSummary,
            blockStats: {
              total: log.blockCount,
              success: log.successCount,
              error: log.errorCount,
              skipped: log.skippedCount,
            },
            traceSpans,
            blockExecutions,
            enhanced: true,
          },
        }
      })

      if (params.includeWorkflow) {
        const workflowIds = [...new Set(logs.map((log) => log.workflowId))]
        const workflowConditions = inArray(workflow.id, workflowIds)

        const workflowData = await db.select().from(workflow).where(workflowConditions)
        const workflowMap = new Map(workflowData.map((w) => [w.id, w]))

        const logsWithWorkflow = enhancedLogs.map((log) => ({
          ...log,
          workflow: workflowMap.get(log.workflowId) || null,
        }))

        return NextResponse.json(
          {
            data: logsWithWorkflow,
            total: Number(count),
            page: Math.floor(params.offset / params.limit) + 1,
            pageSize: params.limit,
            totalPages: Math.ceil(Number(count) / params.limit),
          },
          { status: 200 }
        )
      }

      // Include block execution data if requested
      if (params.includeBlocks) {
        const executionIds = logs.map((log) => log.executionId)

        if (executionIds.length > 0) {
          const blockLogs = await db
            .select()
            .from(workflowExecutionBlocks)
            .where(inArray(workflowExecutionBlocks.executionId, executionIds))
            .orderBy(workflowExecutionBlocks.startedAt)

          // Group block logs by execution ID
          const blockLogsByExecution = blockLogs.reduce(
            (acc, blockLog) => {
              if (!acc[blockLog.executionId]) {
                acc[blockLog.executionId] = []
              }
              acc[blockLog.executionId].push({
                id: blockLog.id,
                blockId: blockLog.blockId,
                blockName: blockLog.blockName || '',
                blockType: blockLog.blockType,
                startedAt: blockLog.startedAt.toISOString(),
                endedAt: blockLog.endedAt?.toISOString() || blockLog.startedAt.toISOString(),
                durationMs: blockLog.durationMs || 0,
                status: blockLog.status,
                errorMessage: blockLog.errorMessage || undefined,
                inputData: blockLog.inputData,
                outputData: blockLog.outputData,
                cost: blockLog.costTotal
                  ? {
                      input: Number(blockLog.costInput) || 0,
                      output: Number(blockLog.costOutput) || 0,
                      total: Number(blockLog.costTotal) || 0,
                      tokens: {
                        prompt: blockLog.tokensPrompt || 0,
                        completion: blockLog.tokensCompletion || 0,
                        total: blockLog.tokensTotal || 0,
                      },
                      model: blockLog.modelUsed || '',
                    }
                  : undefined,
              })
              return acc
            },
            {} as Record<string, any[]>
          )

          // For executions with no block logs in the database,
          // extract block executions from stored trace spans in metadata
          logs.forEach((log) => {
            if (
              !blockLogsByExecution[log.executionId] ||
              blockLogsByExecution[log.executionId].length === 0
            ) {
              const storedTraceSpans = (log.metadata as any)?.traceSpans
              if (storedTraceSpans && Array.isArray(storedTraceSpans)) {
                blockLogsByExecution[log.executionId] =
                  extractBlockExecutionsFromTraceSpans(storedTraceSpans)
              }
            }
          })

          // Add block logs to metadata
          const logsWithBlocks = enhancedLogs.map((log) => ({
            ...log,
            metadata: {
              ...log.metadata,
              blockExecutions: blockLogsByExecution[log.executionId] || [],
            },
          }))

          return NextResponse.json(
            {
              data: logsWithBlocks,
              total: Number(count),
              page: Math.floor(params.offset / params.limit) + 1,
              pageSize: params.limit,
              totalPages: Math.ceil(Number(count) / params.limit),
            },
            { status: 200 }
          )
        }
      }

      // Return basic logs
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
        logger.warn(`[${requestId}] Invalid enhanced logs request parameters`, {
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
    logger.error(`[${requestId}] Enhanced logs fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
