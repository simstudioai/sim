import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { wasExecutionFinalizedByCore } from '@/lib/workflows/executor/execution-core'

/**
 * Whether a failure thrown out of `executeWorkflowCore` is already recorded as
 * the run's failed execution log — a user or workflow error, not a job fault.
 *
 * Core records the failure and marks it finalized inside a post-execution
 * promise it does not await before rethrowing, so this settles that promise
 * first. Checking the mark without it misses nearly every recorded failure.
 */
export async function isRecordedWorkflowFailure(
  error: unknown,
  executionId: string,
  loggingSession: Pick<LoggingSession, 'waitForPostExecution'>
): Promise<boolean> {
  await loggingSession.waitForPostExecution()
  return wasExecutionFinalizedByCore(error, executionId)
}
