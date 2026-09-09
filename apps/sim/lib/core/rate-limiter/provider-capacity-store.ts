import { db } from '@sim/db'
import { rateLimitBucket } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import { PROVIDER_CAPACITY_SCRIPT } from '@/lib/core/rate-limiter/provider-capacity-lua'
import {
  type ProviderCapacityAction,
  type ProviderCapacityConfig,
  type ProviderCapacityResult,
  type ProviderCapacityState,
  updateProviderCapacity,
} from '@/lib/core/rate-limiter/provider-capacity-state'
import { getStorageMethod } from '@/lib/core/storage'

/** Cancels the caller's wait even when a storage client's connection or command queue stalls. */
async function withinStorageDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineAt: number,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const remainingMs = deadlineAt - Date.now()
  if (remainingMs <= 0) throw new Error('Provider capacity storage deadline expired')
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  let rejectWait: (reason: unknown) => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectWait = reject
  })
  const rejectAborted = () => rejectWait(controller.signal.reason)
  controller.signal.addEventListener('abort', rejectAborted, { once: true })
  const timer = setTimeout(() => {
    controller.abort(new Error('Provider capacity storage deadline expired'))
  }, remainingMs)
  try {
    return await Promise.race([operation(controller.signal), aborted])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', rejectAborted)
  }
}

/** One atomic state update; Redis outages never split provider capacity into another backend. */
export async function mutateProviderCapacity(
  key: string,
  config: ProviderCapacityConfig,
  action: ProviderCapacityAction,
  deadlineAt: number,
  signal?: AbortSignal
): Promise<ProviderCapacityResult> {
  return withinStorageDeadline(
    async (operationSignal) => {
      operationSignal.throwIfAborted()
      if (getStorageMethod() === 'redis') {
        const redis = getRedisClient()
        if (!redis) throw new Error('Configured provider capacity Redis is unavailable')
        const result = await redis.eval(
          PROVIDER_CAPACITY_SCRIPT,
          1,
          `ratelimit:tb:${key}`,
          JSON.stringify(config),
          JSON.stringify(action),
          String(deadlineAt)
        )
        operationSignal.throwIfAborted()
        const parsed: ProviderCapacityResult = JSON.parse(String(result))
        if (
          typeof parsed.allowed !== 'boolean' ||
          !Number.isFinite(parsed.retryAfterMs) ||
          parsed.retryAfterMs < 0 ||
          (parsed.cooldownRemainingMs !== undefined &&
            (!Number.isFinite(parsed.cooldownRemainingMs) || parsed.cooldownRemainingMs < 0)) ||
          !Number.isFinite(parsed.scale) ||
          parsed.scale <= 0 ||
          parsed.scale > 1 ||
          !Number.isSafeInteger(parsed.inFlight) ||
          parsed.inFlight < 0
        )
          throw new Error('Invalid provider capacity storage response')
        return parsed
      }

      return db.transaction(async (tx) => {
        operationSignal.throwIfAborted()
        const remainingMs = Math.max(1, deadlineAt - Date.now())
        await tx.execute(
          sql`SELECT set_config('statement_timeout', ${String(remainingMs)}, true), set_config('lock_timeout', ${String(remainingMs)}, true)`
        )
        operationSignal.throwIfAborted()
        await tx
          .insert(rateLimitBucket)
          .values({ key, tokens: '0', lastRefillAt: new Date() })
          .onConflictDoNothing()
        operationSignal.throwIfAborted()
        const [row] = await tx
          .select({
            state: rateLimitBucket.capacityState,
          })
          .from(rateLimitBucket)
          .where(eq(rateLimitBucket.key, key))
          .for('update')
          .limit(1)
        if (!row) throw new Error('Provider capacity state disappeared')
        operationSignal.throwIfAborted()
        if (Date.now() >= deadlineAt) throw new Error('Provider capacity storage deadline expired')
        /** Read the backend clock after the row lock, including any contention wait. */
        const clock = await tx.execute<{ now: string }>(
          sql`SELECT floor(extract(epoch from clock_timestamp()) * 1000)::bigint AS now`
        )
        const now = Number(clock[0]?.now)
        if (!Number.isFinite(now)) throw new Error('Provider capacity storage clock unavailable')
        const stored = row.state as ProviderCapacityState | null
        if (
          stored &&
          (stored.version !== 1 ||
            !Array.isArray(stored.leases) ||
            (stored.pageWindow !== undefined && !Array.isArray(stored.pageWindow)))
        ) {
          throw new Error('Unsupported provider capacity state')
        }
        const { state, result } = updateProviderCapacity(stored, config, action, now)
        await tx
          .update(rateLimitBucket)
          .set({ capacityState: state, updatedAt: new Date(now) })
          .where(eq(rateLimitBucket.key, key))
        operationSignal.throwIfAborted()
        if (Date.now() >= deadlineAt) throw new Error('Provider capacity storage deadline expired')
        return result
      })
    },
    deadlineAt,
    signal
  )
}
