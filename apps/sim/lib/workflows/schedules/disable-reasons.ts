/**
 * Why Sim turned a schedule off. Threaded from the disable call site into the
 * notification, because `workflow_schedule` has no column that records it.
 */
export type ScheduleDisableReason =
  | 'consecutive_failures'
  | 'authentication_error'
  | 'authorization_error'
  | 'workflow_not_found'
  | 'invalid_schedule'

/**
 * User-facing sentence for each reason. Fixed copy rather than the underlying
 * error string: the threshold paths carry arbitrary workflow-execution errors
 * that can contain credentials or customer data.
 */
export const SCHEDULE_DISABLE_REASON_COPY: Record<ScheduleDisableReason, string> = {
  consecutive_failures: 'It failed too many times in a row.',
  authentication_error: 'The run could not be authenticated.',
  authorization_error: 'The run was not authorized.',
  workflow_not_found: 'The workflow could not be found.',
  invalid_schedule: 'The schedule is no longer valid.',
}
