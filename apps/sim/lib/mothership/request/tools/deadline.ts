import { TOOL_DEADLINE_SETTLE_MARGIN_MS } from '@/lib/mothership/generated/protocol'

/** The longest worker wait a frame may name; a larger or malformed value is ignored. */
const MAX_FRAME_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * When Sim must have settled a call whose frame names the worker's wait (`deadlineMs`, from
 * hand-off), received at `receivedAt`. Undefined when the frame names none: the call keeps
 * Sim's own bounds.
 */
export function frameToolDeadlineAt(deadlineMs: unknown, receivedAt: number): number | undefined {
  if (
    typeof deadlineMs !== 'number' ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs <= 0 ||
    deadlineMs > MAX_FRAME_DEADLINE_MS
  )
    return undefined
  return receivedAt + deadlineMs - TOOL_DEADLINE_SETTLE_MARGIN_MS
}

/** The column value for a call's deadline. */
export function toDeadlineDate(deadlineAt: number | undefined): Date | undefined {
  return deadlineAt === undefined ? undefined : new Date(deadlineAt)
}

/** A wait of `budgetMs` starting at `now`, shortened so it ends by the call's deadline. */
export function capToToolDeadline(
  budgetMs: number,
  deadlineAt: number | undefined,
  now: number
): number {
  return deadlineAt === undefined ? budgetMs : Math.max(0, Math.min(budgetMs, deadlineAt - now))
}
