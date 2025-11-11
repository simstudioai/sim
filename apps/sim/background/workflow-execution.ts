import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
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
    const wfRows = await db
      .select({ workspaceId: workflowTable.workspaceId })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)
    const workspaceId = wfRows[0]?.workspaceId || undefined

    const usageCheck = await checkServerSideUsageLimits(payload.userId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${payload.userId} has exceeded usage limits. Skipping workflow execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId,
        }
      )

      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId: workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message:
            usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      throw new Error(
        usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }

    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId: workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message:
            'Workflow not found. The workflow may have been deleted or is no longer accessible.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      throw new Error(`Workflow ${workflowId} not found`)
    }

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId,
      workspaceId,
      userId: payload.userId,
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
