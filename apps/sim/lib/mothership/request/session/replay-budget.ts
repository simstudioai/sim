import type { RedisBudgetRefusal } from '@/lib/core/redis/byte-budget.server'
import { StreamTurnFailure } from '@/lib/mothership/request/session/turn-failure'

/** Run-error code for a turn stopped because its replay buffer refused a write. */
export const REPLAY_BUDGET_EXHAUSTED_CODE = 'replay_budget_exhausted'

const STREAM_LIMIT_MESSAGE =
  'This response produced more output than a single response can stream, so it was stopped. The work it already completed has been saved — send a message to continue from there.'

const HOURLY_LIMIT_MESSAGE =
  'Your recent responses streamed more output than the hourly limit allows, so this one was stopped. The work it already completed has been saved — you can continue once the limit resets within the hour.'

/**
 * The replay buffer refused an event a leased controller had to persist before
 * delivering it. No replacement can persist the same event either, so the turn ends.
 */
export class StreamReplayBudgetExhaustedError extends StreamTurnFailure {
  readonly code = REPLAY_BUDGET_EXHAUSTED_CODE

  constructor(readonly refusal: RedisBudgetRefusal) {
    super('Stream replay byte budget exhausted')
    this.name = 'StreamReplayBudgetExhaustedError'
  }

  /** What the user is told; the per-user ceiling is a fixed hourly window. */
  get userMessage(): string {
    return this.refusal.resource === 'user_redis_bytes'
      ? HOURLY_LIMIT_MESSAGE
      : STREAM_LIMIT_MESSAGE
  }
}
