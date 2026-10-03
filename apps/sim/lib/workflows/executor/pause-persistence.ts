import { createLogger } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('PausePersistence')

interface HandlePostExecutionPauseStateArgs {
  result: ExecutionResult
  workflowId: string
  executionId: string
  reservationId?: string
  loggingSession: LoggingSession
}

/**
 * Handles pause persistence and resume queue processing after `executeWorkflowCore` returns.
 *
 * Every caller of `executeWorkflowCore` must call this after execution completes
 * to ensure HITL pause state is persisted to the database and queued resumes are drained.
 *
 * - If execution is paused but its log was never finalized: marks execution as failed
 * - If execution is paused without a snapshot: marks execution as failed
 * - If execution is paused with a valid snapshot: persists to `paused_executions` table
 * - If execution is not paused: processes any queued resume entries
 *
 * A pause is published only after the core's post-execution logging has persisted
 * the paused log. A resume claims that log only once it has left `running`, so a
 * pause published before then (or without it ever happening) is rejected as no
 * longer resumable.
 */
export async function handlePostExecutionPauseState({
  result,
  workflowId,
  executionId,
  reservationId = executionId,
  loggingSession,
}: HandlePostExecutionPauseStateArgs): Promise<void> {
  if (result.status === 'paused') {
    await loggingSession.waitForPostExecution()
    if (!loggingSession.hasCompleted()) {
      logger.error('Paused execution log was not finalized', { executionId })
      await loggingSession.markAsFailed('Failed to record paused execution')
    } else if (!result.snapshotSeed) {
      logger.error('Missing snapshot seed for paused execution', { executionId })
      await loggingSession.markAsFailed('Missing snapshot seed for paused execution')
    } else {
      try {
        await PauseResumeManager.persistPauseResult({
          workflowId,
          executionId,
          reservationId,
          pausePoints: result.pausePoints || [],
          snapshotSeed: result.snapshotSeed,
          executorUserId: result.metadata?.userId,
        })
      } catch (pauseError) {
        logger.error('Failed to persist pause result', {
          executionId,
          error: toError(pauseError).message,
          cause: describeError(pauseError),
          retryable: isRetryableInfrastructureError(pauseError),
        })
        await loggingSession.markAsFailed(
          `Failed to persist pause state: ${toError(pauseError).message}`
        )
      }
    }
  } else {
    try {
      await PauseResumeManager.processQueuedResumes(executionId, workflowId)
    } catch (resumeError) {
      logger.error('Failed to process queued resumes', {
        executionId,
        error: toError(resumeError).message,
        cause: describeError(resumeError),
        retryable: isRetryableInfrastructureError(resumeError),
      })
    }
  }
}
