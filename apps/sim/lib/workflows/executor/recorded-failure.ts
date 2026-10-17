import {
  type ExecutionScope,
  ExecutionScopeDeletedError,
} from '@/lib/core/errors/execution-scope-deleted'
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

/**
 * The run's workspace or workflow that was hard-deleted, or `null`. Core throws
 * {@link ExecutionScopeDeletedError} when the scope is gone at start; a scope
 * deleted mid-run surfaces only on the session once core's post-execution
 * finalization fails to write the log, so this settles that promise first.
 * Such a run has no owner left to alert and no log it could ever record.
 */
export async function resolveDeletedExecutionScope(
  error: unknown,
  loggingSession: Pick<LoggingSession, 'waitForPostExecution' | 'getDeletedScope'>
): Promise<ExecutionScope | null> {
  if (error instanceof ExecutionScopeDeletedError) return error.scope
  await loggingSession.waitForPostExecution()
  return loggingSession.getDeletedScope()
}
