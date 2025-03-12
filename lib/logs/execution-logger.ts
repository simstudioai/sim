import { v4 as uuidv4 } from 'uuid'
import { db } from '@/db'
import { workflowLogs } from '@/db/schema'
import { ExecutionResult as ExecutorResult } from '@/executor/types'

export interface LogEntry {
  id: string
  workflowId: string
  executionId: string
  level: string
  message: string
  createdAt: Date
  duration?: string
  trigger?: string
}

export async function persistLog(log: LogEntry) {
  await db.insert(workflowLogs).values(log)
}

/**
 * Persists logs for a workflow execution, including individual block logs and the final result
 * @param workflowId - The ID of the workflow
 * @param executionId - The ID of the execution
 * @param result - The execution result
 * @param triggerType - The type of trigger (api, webhook, schedule)
 */
export async function persistExecutionLogs(
  workflowId: string,
  executionId: string,
  result: ExecutorResult,
  triggerType: 'api' | 'webhook' | 'schedule'
) {
  try {
    // Log each execution step
    for (const log of result.logs || []) {
      await persistLog({
        id: uuidv4(),
        workflowId,
        executionId,
        level: log.success ? 'info' : 'error',
        message: log.success
          ? `Block ${log.blockName || log.blockId} (${log.blockType || 'unknown'}): ${JSON.stringify(log.output?.response || {})}`
          : `Block ${log.blockName || log.blockId} (${log.blockType || 'unknown'}): ${log.error || 'Failed'}`,
        duration: log.success ? `${log.durationMs}ms` : 'NA',
        trigger: triggerType,
        createdAt: new Date(log.endedAt || log.startedAt),
      })
    }

    // Calculate total duration from successful block logs
    const totalDuration = (result.logs || [])
      .filter((log) => log.success)
      .reduce((sum, log) => sum + log.durationMs, 0)

    // Get trigger-specific message
    const successMessage = getTriggerSuccessMessage(triggerType)
    const errorPrefix = getTriggerErrorPrefix(triggerType)

    // Log the final execution result
    await persistLog({
      id: uuidv4(),
      workflowId,
      executionId,
      level: result.success ? 'info' : 'error',
      message: result.success ? successMessage : `${errorPrefix} execution failed: ${result.error}`,
      duration: result.success ? `${totalDuration}ms` : 'NA',
      trigger: triggerType,
      createdAt: new Date(),
    })
  } catch (error: any) {
    console.error(`Error persisting execution logs: ${error.message}`, error)
  }
}

/**
 * Persists an error log for a workflow execution
 * @param workflowId - The ID of the workflow
 * @param executionId - The ID of the execution
 * @param error - The error that occurred
 * @param triggerType - The type of trigger (api, webhook, schedule)
 */
export async function persistExecutionError(
  workflowId: string,
  executionId: string,
  error: Error,
  triggerType: 'api' | 'webhook' | 'schedule'
) {
  try {
    const errorPrefix = getTriggerErrorPrefix(triggerType)

    await persistLog({
      id: uuidv4(),
      workflowId,
      executionId,
      level: 'error',
      message: `${errorPrefix} execution failed: ${error.message}`,
      duration: 'NA',
      trigger: triggerType,
      createdAt: new Date(),
    })
  } catch (logError: any) {
    console.error(`Error persisting execution error log: ${logError.message}`, logError)
  }
}

// Helper functions for trigger-specific messages
function getTriggerSuccessMessage(triggerType: 'api' | 'webhook' | 'schedule'): string {
  switch (triggerType) {
    case 'api':
      return 'API workflow executed successfully'
    case 'webhook':
      return 'Webhook workflow executed successfully'
    case 'schedule':
      return 'Scheduled workflow executed successfully'
    default:
      return 'Workflow executed successfully'
  }
}

function getTriggerErrorPrefix(triggerType: 'api' | 'webhook' | 'schedule'): string {
  switch (triggerType) {
    case 'api':
      return 'API workflow'
    case 'webhook':
      return 'Webhook workflow'
    case 'schedule':
      return 'Scheduled workflow'
    default:
      return 'Workflow'
  }
}
