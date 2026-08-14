import { elapsedDurationMsSql } from '@/lib/logs/execution/duration'

/**
 * The fields every terminal cancellation sets on a `workflow_execution_logs`
 * row, ready to spread into `.set()`.
 *
 * The five cancellation paths — direct, workflow-group with and without a
 * sidecar, paused, and the async cancel route — differ in their database
 * handle, their claim predicate, whether they read the row back, and what they
 * do when the claim is lost, so they remain separate statements. What they must
 * not differ in is the row they leave behind, and hand-assembling this payload
 * at each one had already dropped `executionDeadlineAt` at a single site,
 * leaving a cancelled run still carrying the deadline of an attempt that had
 * stopped running.
 */
export function cancelledExecutionLogFields(endedAt: Date) {
  return {
    status: 'cancelled' as const,
    endedAt,
    totalDurationMs: elapsedDurationMsSql(endedAt),
    executionDeadlineAt: null,
  }
}
