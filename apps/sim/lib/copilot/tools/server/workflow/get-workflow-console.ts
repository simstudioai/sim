import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { desc, eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

interface GetWorkflowConsoleArgs {
  workflowId: string
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
    tokens?: { total: number; prompt: number; completion: number }
  }
}

interface ExecutionEntry {
  id: string
  executionId: string
  level: string
  trigger: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  totalCost: number | null
  totalTokens: number | null
  blockExecutions: BlockExecution[]
  output?: any
  errorMessage?: string
  errorBlock?: {
    blockId?: string
    blockName?: string
    blockType?: string
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

function normalizeErrorMessage(errorValue: unknown): string | undefined {
  if (!errorValue) return undefined
  if (typeof errorValue === 'string') return errorValue
  if (errorValue instanceof Error) return errorValue.message
  if (typeof errorValue === 'object') {
    try {
      return JSON.stringify(errorValue)
    } catch {}
  }
  try {
    return String(errorValue)
  } catch {
    return undefined
  }
}

function extractErrorFromExecutionData(executionData: any): ExecutionEntry['errorBlock'] & {
  message?: string
} {
  if (!executionData) return {}

  const errorDetails = executionData.errorDetails
  if (errorDetails) {
    const message = normalizeErrorMessage(errorDetails.error || errorDetails.message)
    if (message) {
      return {
        message,
        blockId: errorDetails.blockId,
        blockName: errorDetails.blockName,
        blockType: errorDetails.blockType,
      }
    }
  }

  const finalOutputError = normalizeErrorMessage(executionData.finalOutput?.error)
  if (finalOutputError) {
    return {
      message: finalOutputError,
      blockName: 'Workflow',
    }
  }

  const genericError = normalizeErrorMessage(executionData.error)
  if (genericError) {
    return {
      message: genericError,
      blockName: 'Workflow',
    }
  }

  return {}
}

function extractErrorFromTraceSpans(traceSpans: any[]): ExecutionEntry['errorBlock'] & {
  message?: string
} {
  if (!Array.isArray(traceSpans) || traceSpans.length === 0) return {}

  const queue = [...traceSpans]
  while (queue.length > 0) {
    const span = queue.shift()
    if (!span || typeof span !== 'object') continue

    const message =
      normalizeErrorMessage(span.output?.error) ||
      normalizeErrorMessage(span.error) ||
      normalizeErrorMessage(span.output?.message) ||
      normalizeErrorMessage(span.message)

    const status = span.status
    if (status === 'error' || message) {
      return {
        message,
        blockId: span.blockId,
        blockName: span.blockName || span.name || (span.blockId ? undefined : 'Workflow'),
        blockType: span.blockType || span.type,
      }
    }

    if (Array.isArray(span.children)) {
      queue.push(...span.children)
    }
  }

  return {}
}

function deriveExecutionErrorSummary(params: {
  blockExecutions: BlockExecution[]
  traceSpans: any[]
  executionData: any
}): { message?: string; block?: ExecutionEntry['errorBlock'] } {
  const { blockExecutions, traceSpans, executionData } = params

  const blockError = blockExecutions.find((block) => block.status === 'error' && block.errorMessage)
  if (blockError) {
    return {
      message: blockError.errorMessage,
      block: {
        blockId: blockError.blockId,
        blockName: blockError.blockName,
        blockType: blockError.blockType,
      },
    }
  }

  const executionDataError = extractErrorFromExecutionData(executionData)
  if (executionDataError.message) {
    return {
      message: executionDataError.message,
      block: {
        blockId: executionDataError.blockId,
        blockName:
          executionDataError.blockName || (executionDataError.blockId ? undefined : 'Workflow'),
        blockType: executionDataError.blockType,
      },
    }
  }

  const traceError = extractErrorFromTraceSpans(traceSpans)
  if (traceError.message) {
    return {
      message: traceError.message,
      block: {
        blockId: traceError.blockId,
        blockName: traceError.blockName || (traceError.blockId ? undefined : 'Workflow'),
        blockType: traceError.blockType,
      },
    }
  }

  return {}
}

export const getWorkflowConsoleServerTool: BaseServerTool<GetWorkflowConsoleArgs, any> = {
  name: 'get_workflow_console',
  async execute(rawArgs: GetWorkflowConsoleArgs): Promise<any> {
    const logger = createLogger('GetWorkflowConsoleServerTool')
    const {
      workflowId,
      limit = 3,
      includeDetails = true,
    } = rawArgs || ({} as GetWorkflowConsoleArgs)

    if (!workflowId || typeof workflowId !== 'string') {
      throw new Error('workflowId is required')
    }

    logger.info('Fetching workflow console logs', { workflowId, limit, includeDetails })

    const executionLogs = await db
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
      })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.workflowId, workflowId))
      .orderBy(desc(workflowExecutionLogs.startedAt))
      .limit(limit)

    const formattedEntries: ExecutionEntry[] = executionLogs.map((log) => {
      const executionData = log.executionData as any
      const traceSpans = executionData?.traceSpans || []
      const blockExecutions = includeDetails ? extractBlockExecutionsFromTraceSpans(traceSpans) : []

      let finalOutput: any
      if (blockExecutions.length > 0) {
        const sortedBlocks = [...blockExecutions].sort(
          (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
        )
        const outputBlock = sortedBlocks.find(
          (block) =>
            block.status === 'success' &&
            block.outputData &&
            Object.keys(block.outputData).length > 0
        )
        if (outputBlock) finalOutput = outputBlock.outputData
      }

      const { message: errorMessage, block: errorBlock } = deriveExecutionErrorSummary({
        blockExecutions,
        traceSpans,
        executionData,
      })

      return {
        id: log.id,
        executionId: log.executionId,
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt?.toISOString() || null,
        durationMs: log.totalDurationMs,
        totalCost: (log.cost as any)?.total ?? null,
        totalTokens: (log.cost as any)?.tokens?.total ?? null,
        blockExecutions,
        output: finalOutput,
        errorMessage: errorMessage,
        errorBlock: errorBlock,
      }
    })

    const resultSize = JSON.stringify(formattedEntries).length
    logger.info('Workflow console result prepared', {
      entryCount: formattedEntries.length,
      resultSizeKB: Math.round(resultSize / 1024),
      hasBlockDetails: includeDetails,
    })

    return {
      entries: formattedEntries,
      totalEntries: formattedEntries.length,
      workflowId,
      retrievedAt: new Date().toISOString(),
      hasBlockDetails: includeDetails,
    }
  },
}
