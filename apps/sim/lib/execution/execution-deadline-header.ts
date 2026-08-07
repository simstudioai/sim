import { getExecutionDeadlineAt } from '@/lib/core/execution-limits'

export const INTERNAL_EXECUTION_DEADLINE_HEADER = 'X-Sim-Execution-Deadline-Ms'

/** Serializes a workflow deadline for trusted internal HTTP hops. */
export function serializeExecutionDeadlineHeader(signal?: AbortSignal): string | undefined {
  const deadline = getExecutionDeadlineAt(signal)
  return deadline ? String(deadline.getTime()) : undefined
}

/** Parses the absolute deadline carried by a trusted internal request. */
export function parseExecutionDeadlineHeader(headers: Headers): number | undefined {
  const rawDeadline = headers.get(INTERNAL_EXECUTION_DEADLINE_HEADER)
  if (!rawDeadline) return undefined

  const deadline = Number(rawDeadline)
  return Number.isSafeInteger(deadline) && deadline > 0 ? deadline : undefined
}

/** Returns the remaining trusted workflow budget carried by an internal request. */
export function parseRemainingExecutionDeadlineMs(
  headers: Headers,
  now: number = Date.now()
): number | undefined {
  const deadline = parseExecutionDeadlineHeader(headers)
  if (deadline === undefined) return undefined

  return Math.max(1, deadline - now)
}
