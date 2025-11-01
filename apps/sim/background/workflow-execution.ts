import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { getWorkflowById } from '@/lib/workflows/utils'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'

const logger = createLogger('TriggerWorkflowExecution')

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  input?: any
  triggerType?: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  metadata?: Record<string, any>
}

export async function executeWorkflowJob(payload: WorkflowExecutionPayload) {
  const workflowId = payload.workflowId
  const executionId = uuidv4()
  const requestId = executionId.slice(0, 8)

  logger.info(`[${requestId}] Starting workflow execution job: ${workflowId}`, {
    userId: payload.userId,
    triggerType: payload.triggerType,
    executionId,
  })

  // Initialize logging session
  const triggerType = payload.triggerType || 'api'
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  try {
    // Load workflow from database
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Get workspace ID for the workflow
    const wfRows = await db
      .select({ workspaceId: workflowTable.workspaceId })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)
    const workspaceId = wfRows[0]?.workspaceId || undefined

    // Set workspace on workflow object for executeWorkflow function
    const workflowWithWorkspace = {
      ...workflow,
      workspaceId,
    }

    // Use executeWorkflowCore directly for background jobs
    const result = await executeWorkflowCore({
      requestId,
      workflowId,
      userId: payload.userId,
      workflow: workflowWithWorkspace,
      input: payload.input,
      triggerType: payload.triggerType || 'api',
      loggingSession,
      executionId,
      selectedOutputs: undefined,
    })

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
      executionId,
    })

    return {
      success: result.success,
      workflowId: payload.workflowId,
      executionId,
      output: result.output,
      executedAt: new Date().toISOString(),
      metadata: payload.metadata,
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, {
      error: error.message,
      executionId,
    })
    throw error
  }
}

// Trigger.dev task definition
export const workflowExecutionTask = task({
  id: 'workflow-execution',
  run: executeWorkflowJob,
})
