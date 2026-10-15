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

/** What the model learns when a call's deadline passed before the call could start. */
export const TOOL_DEADLINE_BEFORE_START_MESSAGE =
  'This tool call ran out of its time limit before it could start, so it did not run. Nothing changed; it is safe to try again with a smaller request.'

/** What the model learns when a call that started was still unfinished at its deadline. */
export const TOOL_DEADLINE_EXCEEDED_MESSAGE =
  'This tool call did not finish within its time limit and was abandoned. Its outcome is unknown: it may already have taken effect, so inspect the current state before repeating it.'

/**
 * Whether the call's deadline has passed, so nothing more may start for it: no handler, approval
 * wait, server fallback or allowed decision. A call without a deadline never passes one.
 */
export function toolDeadlinePassed(deadlineAt: number | undefined, now: number): boolean {
  return deadlineAt !== undefined && now >= deadlineAt
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
