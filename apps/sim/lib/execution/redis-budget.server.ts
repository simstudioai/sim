import { createLogger, type Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { getRedisClient } from '@/lib/core/config/redis'
import { ExecutionResourceLimitError } from '@/lib/execution/resource-errors'

type RedisClient = NonNullable<ReturnType<typeof getRedisClient>>

const logger = createLogger('ExecutionRedisBudget')
const REDIS_BUDGET_PREFIX = 'execution:redis-budget:'
const MAX_SINGLE_REDIS_WRITE_BYTES = 8 * 1024 * 1024
const MAX_EXECUTION_REDIS_BYTES = 64 * 1024 * 1024
const MAX_USER_REDIS_BYTES = 256 * 1024 * 1024
const REDIS_BUDGET_TTL_SECONDS = 60 * 60

const RESERVE_REDIS_BYTES_SCRIPT = `
local bytes = tonumber(ARGV[1])
local execution_limit = tonumber(ARGV[2])
local user_limit = tonumber(ARGV[3])
local ttl_seconds = tonumber(ARGV[4])
local execution_current = tonumber(redis.call('GET', KEYS[1]) or '0')
if execution_limit > 0 and execution_current + bytes > execution_limit then
  return {0, 'execution_redis_bytes', execution_current}
end
local user_current = 0
if #KEYS >= 2 then
  user_current = tonumber(redis.call('GET', KEYS[2]) or '0')
  if user_limit > 0 and user_current + bytes > user_limit then
    return {0, 'user_redis_bytes', user_current}
  end
end
redis.call('INCRBY', KEYS[1], bytes)
redis.call('EXPIRE', KEYS[1], ttl_seconds)
if #KEYS >= 2 then
  redis.call('INCRBY', KEYS[2], bytes)
  redis.call('EXPIRE', KEYS[2], ttl_seconds)
end
return {1, 'ok', execution_current + bytes, user_current + bytes}
`

const RELEASE_REDIS_BYTES_SCRIPT = `
local bytes = tonumber(ARGV[1])
for i = 1, #KEYS do
  local next_value = redis.call('DECRBY', KEYS[i], bytes)
  if next_value <= 0 then
    redis.call('DEL', KEYS[i])
  end
end
return 1
`

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

export async function reserveExecutionRedisBytes(
  redis: RedisClient,
  reservation: ExecutionRedisBudgetReservation
): Promise<void> {
  if (reservation.bytes <= 0) return

  const limits = getExecutionRedisBudgetLimits()
  if (reservation.bytes > limits.maxSingleWriteBytes) {
    throw new ExecutionResourceLimitError({
      resource: 'redis_key_bytes',
      attemptedBytes: reservation.bytes,
      limitBytes: limits.maxSingleWriteBytes,
    })
  }

  const keys = getExecutionRedisBudgetKeys(reservation)
  const result = (await redis.eval(
    RESERVE_REDIS_BYTES_SCRIPT,
    keys.length,
    ...keys,
    reservation.bytes,
    limits.maxExecutionBytes,
    limits.maxUserBytes,
    limits.ttlSeconds
  )) as [number, string, number | string | null]

  const [allowed, resource, current] = result
  if (allowed === 1) return

  throw new ExecutionResourceLimitError({
    resource: resource === 'user_redis_bytes' ? 'user_redis_bytes' : 'execution_redis_bytes',
    attemptedBytes: reservation.bytes,
    currentBytes: Number(current ?? 0),
    limitBytes: resource === 'user_redis_bytes' ? limits.maxUserBytes : limits.maxExecutionBytes,
  })
}

export async function releaseExecutionRedisBytes(
  redis: RedisClient,
  reservation: ExecutionRedisBudgetReservation
): Promise<void> {
  if (reservation.bytes <= 0) return

  try {
    const keys = getExecutionRedisBudgetKeys(reservation)
    await redis.eval(RELEASE_REDIS_BYTES_SCRIPT, keys.length, ...keys, reservation.bytes)
  } catch (error) {
    const log = reservation.logger ?? logger
    log.warn('Failed to release execution Redis budget reservation', {
      executionId: reservation.executionId,
      userId: reservation.userId,
      category: reservation.category,
      operation: reservation.operation,
      bytes: reservation.bytes,
      error: toError(error).message,
    })
  }
}
