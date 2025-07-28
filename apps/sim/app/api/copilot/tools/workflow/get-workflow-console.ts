import { desc, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
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

class GetWorkflowConsoleTool extends BaseCopilotTool<GetWorkflowConsoleParams, WorkflowConsoleResult> {
  readonly id = 'get_workflow_console'
  readonly displayName = 'Getting workflow console'

  protected async executeImpl(params: GetWorkflowConsoleParams): Promise<WorkflowConsoleResult> {
    return getWorkflowConsole(params)
  }
}

// Export the tool instance
export const getWorkflowConsoleTool = new GetWorkflowConsoleTool()

// Implementation function
async function getWorkflowConsole(params: GetWorkflowConsoleParams): Promise<WorkflowConsoleResult> {
  const logger = createLogger('GetWorkflowConsole')
  const { workflowId, limit = 50, includeDetails = false } = params

  logger.info('Fetching workflow console logs', { workflowId, limit, includeDetails })

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
    .limit(Math.min(limit, 100))

  // Format the response
  const formattedEntries = executionLogs.map((log) => {
    const entry: any = {
      id: log.id,
      executionId: log.executionId,
      level: log.level,
      message: log.message,
      trigger: log.trigger,
      startedAt: log.startedAt,
      endedAt: log.endedAt,
      durationMs: log.totalDurationMs,
      blockCount: log.blockCount,
      successCount: log.successCount,
      errorCount: log.errorCount,
      totalCost: log.totalCost ? Number.parseFloat(log.totalCost.toString()) : null,
      type: 'execution',
    }

    if (log.metadata) {
      entry.metadata = log.metadata
    }

    return entry
  })

  return {
    entries: formattedEntries,
    totalEntries: formattedEntries.length,
    workflowId,
    retrievedAt: new Date().toISOString(),
    hasBlockDetails: false,
  }
}
