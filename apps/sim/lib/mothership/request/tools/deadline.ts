import { SIM_TOOL_MIN_START_BUDGET_MS } from '@/lib/mothership/async-runs/execution-lease'
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

/** Whether the call's deadline has passed. A call without a deadline never passes one. */
export function toolDeadlinePassed(deadlineAt: number | undefined, now: number): boolean {
  return deadlineAt !== undefined && now >= deadlineAt
}

/**
 * The last moment anything may start for a call: its deadline less the minimum start budget,
 * since work started later would likely be abandoned mid-flight, its effects unknown.
 */
export function lastToolStartAt(deadlineAt: number | undefined): number | undefined {
  return deadlineAt === undefined ? undefined : deadlineAt - SIM_TOOL_MIN_START_BUDGET_MS
}

/**
 * Whether it is too late to start anything for the call: no handler, approval prompt, allowed
 * decision, server fallback or client pickup. Exactly the minimum budget left still starts.
 */
export function toolStartWindowClosed(deadlineAt: number | undefined, now: number): boolean {
  const lastStartAt = lastToolStartAt(deadlineAt)
  return lastStartAt !== undefined && now > lastStartAt
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
