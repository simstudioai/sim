import type { RedisBudgetRefusal } from '@/lib/core/redis/byte-budget.server'

/** Run-error code for a turn stopped because its replay buffer refused a write. */
export const REPLAY_BUDGET_EXHAUSTED_CODE = 'replay_budget_exhausted'

export const REPLAY_BUDGET_EXHAUSTED_MESSAGE =
  'This turn produced more output than a single response can stream, so it was stopped. The work it already completed has been saved — send a message to continue from there.'

/**
 * The replay buffer refused an event a leased controller had to persist before
 * delivering it. Unlike {@link StreamControllerSupersededError} this is not a
 * handoff: no replacement can persist the same event either, so the turn ends.
 */
export class StreamReplayBudgetExhaustedError extends Error {
  readonly code = REPLAY_BUDGET_EXHAUSTED_CODE

  constructor(readonly refusal: RedisBudgetRefusal) {
    super('Stream replay byte budget exhausted')
    this.name = 'StreamReplayBudgetExhaustedError'
  }
}
