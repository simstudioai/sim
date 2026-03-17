import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'

const logger = createLogger('GetWorkflowLogsServerTool')

interface GetWorkflowLogsArgs {
  workflowId: string
  executionId?: string
  limit?: number
  includeDetails?: boolean
}

interface BlockExecution {
  id: string
  blockId: string
  blockName: string
  blockType: string
  startedAt: string
  endedAt: string
  durationMs: number
  status: 'success' | 'error' | 'skipped'
  errorMessage?: string
  inputData: any
  outputData: any
  cost?: {
    total: number
    input: number
    output: number
    model?: string
    tokens?: { total: number; input: number; output: number }
  }
}

function extractBlockExecutionsFromTraceSpans(traceSpans: any[]): BlockExecution[] {
  const blockExecutions: BlockExecution[] = []

  function processSpan(span: any) {
    if (span?.blockId) {
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
      })
    }
    if (span?.children && Array.isArray(span.children)) {
      span.children.forEach(processSpan)
    }
  }

  traceSpans.forEach(processSpan)
  return blockExecutions
}

export const getWorkflowLogsServerTool: BaseServerTool<GetWorkflowLogsArgs, any> = {
  name: 'get_workflow_logs',
  async execute(rawArgs: GetWorkflowLogsArgs, context?: { userId: string }): Promise<any> {
    const {
      workflowId,
      executionId,
      limit = 2,
      includeDetails = false,
    } = rawArgs || ({} as GetWorkflowLogsArgs)

    if (!workflowId || typeof workflowId !== 'string') {
      throw new Error('workflowId is required')
    }
    if (!context?.userId) {
      throw new Error('Unauthorized workflow access')
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: context.userId,
      action: 'read',
    })
    if (!authorization.allowed) {
      throw new Error(authorization.message || 'Unauthorized workflow access')
    }

    logger.info('Fetching workflow logs', {
      workflowId,
      executionId,
      limit,
      includeDetails,
    })

    const conditions = [eq(workflowExecutionLogs.workflowId, workflowId)]
    if (executionId) {
      conditions.push(eq(workflowExecutionLogs.executionId, executionId))
    }

    const executionLogs = await db
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        status: workflowExecutionLogs.status,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
      })
      .from(workflowExecutionLogs)
      .where(and(...conditions))
      .orderBy(desc(workflowExecutionLogs.startedAt))
      .limit(executionId ? 1 : limit)

    const simplifiedExecutions = executionLogs.map((log) => {
      const executionData = log.executionData as any
      const traceSpans = executionData?.traceSpans || []
      const blockExecutions = includeDetails ? extractBlockExecutionsFromTraceSpans(traceSpans) : []

      const simplifiedBlocks = blockExecutions.map((block) => ({
        id: block.blockId,
        name: block.blockName,
        startedAt: block.startedAt,
        endedAt: block.endedAt,
        durationMs: block.durationMs,
        output: block.outputData,
        error: block.status === 'error' ? block.errorMessage : undefined,
      }))

      const errorMessage =
        executionData?.errorDetails?.error ||
        executionData?.errorDetails?.message ||
        executionData?.finalOutput?.error ||
        executionData?.error ||
        null

      return {
        executionId: log.executionId,
        status: log.status,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt ? log.endedAt.toISOString() : null,
        durationMs: log.totalDurationMs ?? null,
        ...(errorMessage
          ? {
              error: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
            }
          : {}),
        ...(simplifiedBlocks.length > 0 ? { blocks: simplifiedBlocks } : {}),
      }
    })

    const resultSize = JSON.stringify(simplifiedExecutions).length
    logger.info('Workflow logs result prepared', {
      executionCount: simplifiedExecutions.length,
      resultSizeKB: Math.round(resultSize / 1024),
    })

    return simplifiedExecutions
  },
}
