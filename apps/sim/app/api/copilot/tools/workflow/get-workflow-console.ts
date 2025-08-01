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

interface WorkflowConsoleResult {
  entries: any[]
  totalEntries: number
  workflowId: string
  retrievedAt: string
  hasBlockDetails: boolean
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
  const { workflowId, limit = 10, includeDetails = false } = params

  logger.info('Fetching workflow console logs', { workflowId, limit, includeDetails })

  // Limit the number of entries to prevent large payloads that break streaming
  const effectiveLimit = Math.min(limit, 10) // Cap at 10 entries for streaming safety

  // Get recent execution logs for the workflow
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
      totalCost: workflowExecutionLogs.totalCost,
      metadata: workflowExecutionLogs.metadata,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workflowId, workflowId))
    .orderBy(desc(workflowExecutionLogs.startedAt))
    .limit(effectiveLimit)

  // Format the response with size-conscious trimming
  const formattedEntries = executionLogs.map((log) => {
    const entry: any = {
      id: log.id,
      executionId: log.executionId,
      level: log.level,
      message: log.message,
      // Truncate trigger data if it's too large to prevent streaming issues
      trigger: typeof log.trigger === 'string' && log.trigger.length > 100 
        ? log.trigger.substring(0, 100) + '...' 
        : log.trigger,
      startedAt: log.startedAt,
      endedAt: log.endedAt,
      durationMs: log.totalDurationMs,
      blockCount: log.blockCount,
      successCount: log.successCount,
      errorCount: log.errorCount,
      totalCost: log.totalCost ? Number.parseFloat(log.totalCost.toString()) : null,
      type: 'execution',
    }

    // Only include metadata if details are requested and it's not too large
    if (includeDetails && log.metadata) {
      const metadataStr = typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata)
      if (metadataStr.length <= 500) { // Limit metadata size
        entry.metadata = log.metadata
      }
    }

    return entry
  })

  // Log the result size for monitoring
  const resultSize = JSON.stringify(formattedEntries).length
  logger.info('Workflow console result prepared', { 
    entryCount: formattedEntries.length, 
    resultSizeKB: Math.round(resultSize / 1024) 
  })

  return {
    entries: formattedEntries,
    totalEntries: formattedEntries.length,
    workflowId,
    retrievedAt: new Date().toISOString(),
    hasBlockDetails: false,
  }
}
