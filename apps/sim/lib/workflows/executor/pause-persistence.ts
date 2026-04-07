import { createLogger } from '@sim/logger'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('PausePersistence')

interface HandlePostExecutionPauseStateArgs {
  result: ExecutionResult
  workflowId: string
  executionId: string
  loggingSession: LoggingSession
}

/**
 * Handles pause persistence and resume queue processing after `executeWorkflowCore` returns.
 *
 * Every caller of `executeWorkflowCore` must call this after execution completes
 * to ensure HITL pause state is persisted to the database and queued resumes are drained.
 *
 * - If execution is paused with a valid snapshot: persists to `paused_executions` table
 * - If execution is paused without a snapshot: marks execution as failed
 * - If execution is not paused: processes any queued resume entries
 */
export async function handlePostExecutionPauseState({
  result,
  workflowId,
  executionId,
  loggingSession,
}: HandlePostExecutionPauseStateArgs): Promise<void> {
  if (result.status === 'paused') {
    if (!result.snapshotSeed) {
      logger.error('Missing snapshot seed for paused execution', { executionId })
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
        logger.error('Failed to persist pause result', {
          executionId,
          error: pauseError instanceof Error ? pauseError.message : String(pauseError),
        })
        await loggingSession.markAsFailed(
          `Failed to persist pause state: ${pauseError instanceof Error ? pauseError.message : String(pauseError)}`
        )
      }
    }
  } else {
    try {
      await PauseResumeManager.processQueuedResumes(executionId)
    } catch (resumeError) {
      logger.error('Failed to process queued resumes', {
        executionId,
        error: resumeError instanceof Error ? resumeError.message : String(resumeError),
      })
    }
  }
}
