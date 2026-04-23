import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, desc, eq } from 'drizzle-orm'
import { GetWorkflowLogs } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import type { TraceSpan } from '@/stores/logs/filters/types'

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
  inputData: Record<string, unknown>
  outputData: Record<string, unknown>
  cost?: {
    total: number
    input: number
    output: number
    model?: string
    tokens?: { total: number; input: number; output: number }
  }
}

interface SimplifiedBlock {
  id: string
  name: string
  startedAt: string
  endedAt: string
  durationMs: number
  output: Record<string, unknown>
  error: string | undefined
}

interface SimplifiedExecution {
  id: string
  executionId: string
  status: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  error?: string
  blocks?: SimplifiedBlock[]
}

/** Shape of the JSONB executionData column fields we access. */
interface ExecutionData {
  traceSpans?: TraceSpan[]
  errorDetails?: { error?: unknown; message?: unknown }
  finalOutput?: { error?: unknown }
  error?: unknown
}

function extractBlockExecutionsFromTraceSpans(traceSpans: TraceSpan[]): BlockExecution[] {
  const blockExecutions: BlockExecution[] = []

  function processSpan(span: TraceSpan) {
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
        errorMessage: span.output?.error as string | undefined,
        inputData: span.input || {},
        outputData: span.output || {},
        cost: span.cost
          ? {
              total: span.cost.total ?? 0,
              input: span.cost.input ?? 0,
              output: span.cost.output ?? 0,
            }
          : undefined,
      })
    }
    span.children?.forEach(processSpan)
  }

  traceSpans.forEach(processSpan)
  return blockExecutions
}

export const getWorkflowLogsServerTool: BaseServerTool<GetWorkflowLogsArgs, SimplifiedExecution[]> =
  {
    name: GetWorkflowLogs.id,
    async execute(
      rawArgs: GetWorkflowLogsArgs,
      context?: { userId: string }
    ): Promise<SimplifiedExecution[]> {
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

      const simplifiedExecutions: SimplifiedExecution[] = executionLogs.map((log) => {
        const executionData = log.executionData as ExecutionData
        const traceSpans = executionData?.traceSpans ?? []
        const blockExecutions = includeDetails
          ? extractBlockExecutionsFromTraceSpans(traceSpans)
          : []

        const simplifiedBlocks: SimplifiedBlock[] = blockExecutions.map((block) => ({
          id: block.blockId,
          name: block.blockName,
          startedAt: block.startedAt,
          endedAt: block.endedAt,
          durationMs: block.durationMs,
          output: block.outputData,
          error: block.status === 'error' ? block.errorMessage : undefined,
        }))

        const rawError =
          executionData?.errorDetails?.error ||
          executionData?.errorDetails?.message ||
          executionData?.finalOutput?.error ||
          executionData?.error ||
          null
        const errorMessage = rawError
          ? typeof rawError === 'string'
            ? rawError
            : JSON.stringify(rawError)
          : undefined

        return {
          id: log.id,
          executionId: log.executionId,
          status: log.status,
          startedAt: log.startedAt.toISOString(),
          endedAt: log.endedAt ? log.endedAt.toISOString() : null,
          durationMs: log.totalDurationMs ?? null,
          ...(errorMessage ? { error: errorMessage } : {}),
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
