import { task } from '@trigger.dev/sdk'
import { v4 as uuidv4 } from 'uuid'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { getWorkflowById } from '@/lib/workflows/utils'
import { type ExecutionMetadata, ExecutionSnapshot } from '@/executor/execution/snapshot'

const logger = createLogger('TriggerWorkflowExecution')

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  input?: any
  triggerType?: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  metadata?: Record<string, any>
}

/**
 * Background workflow execution job
 * @see preprocessExecution For detailed information on preprocessing checks
 * @see executeWorkflowCore For the core workflow execution logic
 */
export async function executeWorkflowJob(payload: WorkflowExecutionPayload) {
  const workflowId = payload.workflowId
  const executionId = uuidv4()
  const requestId = executionId.slice(0, 8)

  logger.info(`[${requestId}] Starting workflow execution job: ${workflowId}`, {
    userId: payload.userId,
    triggerType: payload.triggerType,
    executionId,
  })

  const triggerType = payload.triggerType || 'api'
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  try {
    const preprocessResult = await preprocessExecution({
      workflowId: payload.workflowId,
      userId: payload.userId,
      triggerType: triggerType,
      executionId: executionId,
      requestId: requestId,
      checkRateLimit: true,
      checkDeployment: true,
      loggingSession: loggingSession,
    })

    if (!preprocessResult.success) {
      logger.error(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`, {
        workflowId,
        statusCode: preprocessResult.error?.statusCode,
      })

      throw new Error(preprocessResult.error?.message || 'Preprocessing failed')
    }

    const actorUserId = preprocessResult.actorUserId!
    const workspaceId = preprocessResult.workflowRecord?.workspaceId || undefined

    logger.info(`[${requestId}] Preprocessing passed. Using actor: ${actorUserId}`)

    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found after preprocessing`)
    }

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId,
      workspaceId,
      userId: actorUserId,
      triggerType: payload.triggerType || 'api',
      useDraftState: false,
      startTime: new Date().toISOString(),
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflow,
      payload.input,
      {},
      workflow.variables || {},
      []
    )

    const result = await executeWorkflowCore({
      snapshot,
      callbacks: {},
      loggingSession,
    })

    if (result.status === 'paused') {
      if (!result.snapshotSeed) {
        logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
          executionId,
        })
      } else {
        await PauseResumeManager.persistPauseResult({
          workflowId,
          executionId,
          pausePoints: result.pausePoints || [],
          snapshotSeed: result.snapshotSeed,
          executorUserId: result.metadata?.userId,
        })
      }
    } else {
      await PauseResumeManager.processQueuedResumes(executionId)
    }

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

export const workflowExecutionTask = task({
  id: 'workflow-execution',
  run: executeWorkflowJob,
})
