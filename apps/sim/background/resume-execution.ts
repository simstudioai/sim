import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

const logger = createLogger('TriggerResumeExecution')

export type ResumeExecutionPayload = {
  resumeEntryId: string
  resumeExecutionId: string
  pausedExecutionId: string
  contextId: string
  resumeInput: unknown
  userId: string
  workflowId: string
  parentExecutionId: string
}

export async function executeResumeJob(payload: ResumeExecutionPayload) {
  const { resumeExecutionId, pausedExecutionId, contextId, workflowId, parentExecutionId } = payload

  logger.info('Starting background resume execution', {
    resumeExecutionId,
    pausedExecutionId,
    contextId,
    workflowId,
    parentExecutionId,
  })

  try {
    const pausedExecution = await PauseResumeManager.getPausedExecutionById(pausedExecutionId)
    if (!pausedExecution) {
      throw new Error(`Paused execution not found: ${pausedExecutionId}`)
    }

    const result = await PauseResumeManager.startResumeExecution({
      resumeEntryId: payload.resumeEntryId,
      resumeExecutionId: payload.resumeExecutionId,
      pausedExecution,
      contextId: payload.contextId,
      resumeInput: payload.resumeInput,
      userId: payload.userId,
    })

    logger.info('Background resume execution completed', {
      resumeExecutionId,
      workflowId,
      success: result.success,
      status: result.status,
    })

    return {
      success: result.success,
      workflowId,
      executionId: resumeExecutionId,
      parentExecutionId,
      status: result.status,
    }
  } catch (error) {
    logger.error('Background resume execution failed', {
      resumeExecutionId,
      workflowId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export const resumeExecutionTask = task({
  id: 'resume-execution',
  machine: 'medium-1x',
  retry: {
    maxAttempts: 1,
  },
  run: executeResumeJob,
})
