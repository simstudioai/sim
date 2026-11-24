import { isRecordLike } from '@sim/utils/object'

/**
 * The message an error finalization (`force_failed`) stored as the run's `finalOutput.error`.
 * Any other run's `finalOutput.error` is the workflow's own data, not a failure message.
 */
export function forceFailedMessage(executionData: Record<string, unknown>): string | undefined {
  if (executionData.finalizationPath !== 'force_failed') return undefined
  const { finalOutput } = executionData
  return isRecordLike(finalOutput) && typeof finalOutput.error === 'string'
    ? finalOutput.error
    : undefined
}

/**
 * The error a failed run recorded for itself, as the run log and status reads report it: its own
 * `error` (a string, or an object with a `message`), the failure its completion recorded
 * (`completionFailure`), else {@link forceFailedMessage}. Undefined when it recorded none, as a
 * run whose status comes from a block's error alone does.
 */
export function runFailureMessage(executionData: unknown): string | undefined {
  if (!isRecordLike(executionData)) return undefined
  const { error, completionFailure } = executionData
  const candidates = [
    error,
    isRecordLike(error) ? error.message : undefined,
    completionFailure,
    forceFailedMessage(executionData),
  ]
  return candidates.find((value): value is string => typeof value === 'string' && value !== '')
}
