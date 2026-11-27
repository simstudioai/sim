import { isRecordLike } from '@sim/utils/object'

/** A command to run next, and why: the `next` of every result that names one. */
export interface NextStep {
  command: string
  reason: string
}

/**
 * A `next` as a person reads it: the command on one line (several, as a paused run's resumes,
 * chained with `&&`), then why as a shell comment, so a pasted line runs only the commands. Null
 * for a value that is not a {@link NextStep}.
 */
export function nextStepText(value: unknown): string | null {
  if (!isRecordLike(value) || typeof value.command !== 'string') return null
  const command = value.command.split('\n').join(' && ')
  return typeof value.reason === 'string' ? `${command}  # ${value.reason}` : command
}
