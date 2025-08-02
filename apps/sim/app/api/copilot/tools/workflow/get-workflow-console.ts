import { desc, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { workflowExecutionLogs } from '@/db/schema'
import { BaseCopilotTool } from '../base'

interface GetWorkflowConsoleParams {
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
    tokens?: {
      total: number
      prompt: number
      completion: number
    }
  }
}

interface ExecutionEntry {
  id: string
  executionId: string
  level: string
  message: string
  trigger: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  blockCount: number
  successCount: number
  errorCount: number
  skippedCount: number
  totalCost: number | null
  totalTokens: number | null
  blockExecutions: BlockExecution[]
  output?: any // Final workflow output
}

interface WorkflowConsoleResult {
  entries: ExecutionEntry[]
  totalEntries: number
  workflowId: string
  retrievedAt: string
  hasBlockDetails: boolean
}

// Helper function to extract block executions from trace spans
function extractBlockExecutionsFromTraceSpans(traceSpans: any[]): BlockExecution[] {
  const blockExecutions: BlockExecution[] = []

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

class GetWorkflowConsoleTool extends BaseCopilotTool<
  GetWorkflowConsoleParams,
  WorkflowConsoleResult
> {
  readonly id = 'get_workflow_console'
  readonly displayName = 'Getting workflow console'

  protected async executeImpl(params: GetWorkflowConsoleParams): Promise<WorkflowConsoleResult> {
    return getWorkflowConsole(params)
  }
}

// Export the tool instance
export const getWorkflowConsoleTool = new GetWorkflowConsoleTool()

// Implementation function
async function getWorkflowConsole(
  params: GetWorkflowConsoleParams
): Promise<WorkflowConsoleResult> {
  const logger = createLogger('GetWorkflowConsole')
  const { workflowId, limit = 3, includeDetails = true } = params // Default to 3 executions and include details

  logger.info('Fetching workflow console logs', { workflowId, limit, includeDetails })

  // Get recent execution logs for the workflow (past 3 executions by default)
  const executionLogs = await db
    .select({
      id: workflowExecutionLogs.id,
      executionId: workflowExecutionLogs.executionId,
      level: workflowExecutionLogs.level,
      message: workflowExecutionLogs.message,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      blockCount: workflowExecutionLogs.blockCount,
      successCount: workflowExecutionLogs.successCount,
      errorCount: workflowExecutionLogs.errorCount,
      skippedCount: workflowExecutionLogs.skippedCount,
      totalCost: workflowExecutionLogs.totalCost,
      totalTokens: workflowExecutionLogs.totalTokens,
      metadata: workflowExecutionLogs.metadata,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workflowId, workflowId))
    .orderBy(desc(workflowExecutionLogs.startedAt))
    .limit(limit)

  // Format the response with detailed block execution data
  const formattedEntries: ExecutionEntry[] = executionLogs.map((log) => {
    // Extract trace spans from metadata
    const metadata = log.metadata as any
    const traceSpans = metadata?.traceSpans || []
    const blockExecutions = extractBlockExecutionsFromTraceSpans(traceSpans)

    // Try to find the final output from the last executed block
    let finalOutput: any
    if (blockExecutions.length > 0) {
      // Look for blocks that typically provide final output (sorted by end time)
      const sortedBlocks = [...blockExecutions].sort(
        (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
      )

      // Find the last successful block that has meaningful output
      const outputBlock = sortedBlocks.find(
        (block) =>
          block.status === 'success' && block.outputData && Object.keys(block.outputData).length > 0
      )

      if (outputBlock) {
        finalOutput = outputBlock.outputData
      }
    }

    const entry: ExecutionEntry = {
      id: log.id,
      executionId: log.executionId,
      level: log.level,
      message: log.message,
      trigger: log.trigger,
      startedAt: log.startedAt.toISOString(),
      endedAt: log.endedAt?.toISOString() || null,
      durationMs: log.totalDurationMs,
      blockCount: log.blockCount,
      successCount: log.successCount,
      errorCount: log.errorCount,
      skippedCount: log.skippedCount || 0,
      totalCost: log.totalCost ? Number.parseFloat(log.totalCost.toString()) : null,
      totalTokens: log.totalTokens,
      blockExecutions: includeDetails ? blockExecutions : [],
      output: finalOutput,
    }

    return entry
  })

  // Log the result size for monitoring
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
}
