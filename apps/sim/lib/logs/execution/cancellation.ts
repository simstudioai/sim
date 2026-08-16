import { elapsedDurationMsSql } from '@/lib/logs/execution/duration'

/**
 * The statuses a terminal write outside `completeWorkflowExecution` can land a
 * `workflow_execution_logs` row on: cancellation, and the force-fail boundaries
 * that bypass the completion path.
 */
type TerminalExecutionLogStatus = 'cancelled' | 'failed'

/**
 * The fields every terminal write outside `completeWorkflowExecution` sets on a
 * `workflow_execution_logs` row, ready to spread into `.set()`.
 *
 * The cancellation paths — direct, workflow-group with and without a sidecar,
 * paused, and the async cancel route — and the two force-fail boundaries —
 * `LoggingSession.markExecutionAsFailed` and `PauseResumeManager.markResumeFailed`
 * — differ in their database handle, their claim predicate, whether they read
 * the row back, and what they do when the claim is lost, so they remain separate
 * statements. What they must not differ in is the row they leave behind, and
 * hand-assembling this payload at each one had already dropped
 * `executionDeadlineAt` at a single cancellation site and both the end timestamp
 * and the duration at both force-fail sites, leaving a terminal run still
 * carrying the deadline of an attempt that had stopped running and invisible to
 * every `minDurationMs`/`maxDurationMs` query on `GET /api/v2/logs`.
 *
 * A duration a paused run already recorded still wins — that guard lives in
 * `elapsedDurationMsSql`, keyed on the row's own status, so a force-fail landing
 * on a still-`pending` paused row keeps the checkpoint duration rather than
 * redefining it to include the time the run sat waiting.
 */
export function terminalExecutionLogFields<TStatus extends TerminalExecutionLogStatus>(
  status: TStatus,
  endedAt: Date
) {
  return {
    status,
    endedAt,
    totalDurationMs: elapsedDurationMsSql(endedAt),
    executionDeadlineAt: null,
  }
}

/** {@link terminalExecutionLogFields} bound to the cancellation status. */
export function cancelledExecutionLogFields(endedAt: Date) {
  return terminalExecutionLogFields('cancelled', endedAt)
}
