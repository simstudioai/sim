import type { Logger } from '@sim/logger'

const REDIS_BUDGET_PREFIX = 'execution:redis-budget:'
const MAX_SINGLE_REDIS_WRITE_BYTES = 8 * 1024 * 1024
const MAX_EXECUTION_REDIS_BYTES = 64 * 1024 * 1024
const MAX_USER_REDIS_BYTES = 256 * 1024 * 1024

/**
 * Window applied to both budget keys, but extended differently on purpose by
 * every Lua script that enforces them — `FLUSH_EVENTS_SCRIPT` and
 * `RESET_STREAM_SCRIPT` in `event-buffer.ts`, and the base64 cache pair in
 * `lib/uploads/utils/user-file-base64.server.ts`.
 *
 * An execution key accounts for data that is refreshed on the same schedule as
 * the key itself, so sliding its TTL on every write keeps the counter and the
 * bytes it represents in step.
 *
 * A user key aggregates across every execution that user runs. Sliding its TTL
 * on each write keeps it alive indefinitely for any user who stays active,
 * while the per-execution data it accounts for keeps expiring underneath it —
 * so the counter accrues bytes Redis has already dropped and eventually pins
 * the user at their ceiling until they go a full TTL without writing. User
 * keys therefore get a fixed window: the TTL is set when the key is created
 * and never extended.
 */
const REDIS_BUDGET_TTL_SECONDS = 60 * 60

export type ExecutionRedisBudgetCategory = 'event_buffer' | 'base64_cache'

export interface ExecutionRedisBudgetReservation {
  executionId: string
  userId?: string
  category: ExecutionRedisBudgetCategory
  bytes: number
  operation: string
  logger?: Logger
}

export function getExecutionRedisBudgetLimits() {
  return {
    maxSingleWriteBytes: MAX_SINGLE_REDIS_WRITE_BYTES,
    maxExecutionBytes: MAX_EXECUTION_REDIS_BYTES,
    maxUserBytes: MAX_USER_REDIS_BYTES,
    ttlSeconds: REDIS_BUDGET_TTL_SECONDS,
  }
}

export function getExecutionRedisBudgetKeys(
  reservation: ExecutionRedisBudgetReservation
): string[] {
  const keys = [`${REDIS_BUDGET_PREFIX}execution:${reservation.executionId}`]
  if (reservation.userId) {
    keys.push(`${REDIS_BUDGET_PREFIX}user:${reservation.userId}`)
  }
  return keys
}
