import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { v4 as uuidv4 } from 'uuid'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { getWorkflowById } from '@/lib/workflows/utils'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('TriggerWorkflowExecution')

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  input?: any
  triggerType?: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat' | 'mcp'
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
    const workspaceId = preprocessResult.workflowRecord?.workspaceId
    if (!workspaceId) {
      throw new Error(`Workflow ${workflowId} has no associated workspace`)
    }

    logger.info(`[${requestId}] Preprocessing passed. Using actor: ${actorUserId}`)

    await loggingSession.safeStart({
      userId: actorUserId,
      workspaceId,
      variables: {},
    })

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
      sessionUserId: undefined,
      workflowUserId: workflow.userId,
      triggerType: payload.triggerType || 'api',
      useDraftState: false,
      startTime: new Date().toISOString(),
      isClientSession: false,
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflow,
      payload.input,
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
        await loggingSession.markAsFailed('Missing snapshot seed for paused execution')
      } else {
        try {
          await PauseResumeManager.persistPauseResult({
            workflowId,
            executionId,
            pausePoints: result.pausePoints || [],
            snapshotSeed: result.snapshotSeed,
            executorUserId: result.metadata?.userId,
          })
        } catch (pauseError) {
          logger.error(`[${requestId}] Failed to persist pause result`, {
            executionId,
            error: pauseError instanceof Error ? pauseError.message : String(pauseError),
          })
          await loggingSession.markAsFailed(
            `Failed to persist pause state: ${pauseError instanceof Error ? pauseError.message : String(pauseError)}`
          )
        }
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
  } catch (error: unknown) {
    logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, {
      error: error instanceof Error ? error.message : String(error),
      executionId,
    })

    const errorWithResult = error as { executionResult?: ExecutionResult }
    const executionResult = errorWithResult?.executionResult
    const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

    await loggingSession.safeCompleteWithError({
      error: {
        message: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      },
      traceSpans,
    })

    throw error
  }
}

export const workflowExecutionTask = task({
  id: 'workflow-execution',
  run: executeWorkflowJob,
})
