import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('HostedKeyQueue')

/**
 * Per-ticket heartbeat TTL. Refreshed by the head while it's actively waiting
 * on the bucket. If the holder crashes, the heartbeat key expires, and the next
 * caller sees the head as dead and removes it (lazy cleanup).
 */
const TICKET_HEARTBEAT_TTL_SECONDS = 30

/** How often the head should refresh its heartbeat while waiting. */
export const HEARTBEAT_REFRESH_INTERVAL_MS = 10_000

/**
 * TTL on the queue list itself. Set on enqueue and re-extended by the head's heartbeat,
 * so a long-waiting head can't let the list expire out from under the waiters behind it.
 * Prevents abandoned queues from sticking around forever in Redis.
 */
const QUEUE_LIST_TTL_SECONDS = 600

const queueListKey = (provider: string, billingActorId: string): string =>
  `hosted-queue:${provider}:${billingActorId}`

const heartbeatKey = (provider: string, billingActorId: string, ticketId: string): string =>
  `hosted-queue-tkt:${provider}:${billingActorId}:${ticketId}`

/**
 * Atomically reap any dead head, then return our ticket's status. Combines what
 * would otherwise be 3 round-trips (reap, LINDEX, LPOS) into one EVAL — meaningful
 * because callers poll this every ~200ms while waiting in the queue.
 *
 * `KEYS[1]` = queue list key. `ARGV[1]` = heartbeat key prefix. `ARGV[2]` = our ticketId.
 *
 * Reaping is bounded: at most one dead head is removed per call. If multiple dead
 * tickets pile up at the head, subsequent polls will clean them one by one. This
 * keeps the script O(1) rather than O(N) and is sufficient because queue depth
 * is bounded by concurrent callers per workspace (typically tens).
 *
 * Returns one of: "head", "waiting", "missing".
 */
const CHECK_HEAD_SCRIPT = `
local head = redis.call("lindex", KEYS[1], 0)
if head and redis.call("exists", ARGV[1] .. head) == 0 then
  redis.call("lrem", KEYS[1], 1, head)
  head = redis.call("lindex", KEYS[1], 0)
end
if not head then
  return "missing"
end
if head == ARGV[2] then
  return "head"
end
if redis.call("lpos", KEYS[1], ARGV[2]) == false then
  return "missing"
end
return "waiting"
`

export interface EnqueueResult {
  /** Position at the moment of enqueue (0 = head, you go next). */
  position: number
  /** Whether Redis was available — false means we're in no-op mode. */
  enabled: boolean
}

/**
 * Per-workspace+provider FIFO queue for hosted-key acquisitions.
 *
 * Callers `enqueue` to claim a position, then `waitForHead` until they're at
 * the head, then attempt to consume from the token bucket. On success or cap
 * exceeded, they `dequeue` to make room for the next caller.
 *
 * No-op when Redis is unavailable: every method returns "you're the head /
 * empty / etc." so the rate limiter falls back to plain bucket racing.
 */
export class HostedKeyQueue {
  /**
   * Push a ticket onto the tail of the queue and write a heartbeat. Returns the
   * position at enqueue time (0 = head, ready to proceed).
   */
  async enqueue(
    provider: string,
    billingActorId: string,
    ticketId: string
  ): Promise<EnqueueResult> {
    const redis = getRedisClient()
    if (!redis) {
      return { position: 0, enabled: false }
    }

    const listKey = queueListKey(provider, billingActorId)
    const hbKey = heartbeatKey(provider, billingActorId, ticketId)

    try {
      const pipeline = redis.multi()
      pipeline.rpush(listKey, ticketId)
      pipeline.expire(listKey, QUEUE_LIST_TTL_SECONDS)
      pipeline.set(hbKey, '1', 'EX', TICKET_HEARTBEAT_TTL_SECONDS)
      const results = await pipeline.exec()
      // results[0] is the rpush response: [err, length]
      const length = results?.[0] && typeof results[0][1] === 'number' ? results[0][1] : 1
      // Position is length - 1 (just-pushed at the tail).
      return { position: length - 1, enabled: true }
    } catch (error) {
      logger.warn(`Queue enqueue failed for ${listKey}`, { error: toError(error).message })
      return { position: 0, enabled: false }
    }
  }

  /**
   * Check whether `ticketId` is currently at the head of the queue. If the head
   * is a different ticket but its heartbeat has expired (caller crashed), reap
   * it and re-check on the next poll.
   *
   * Returns:
   *  - "head": you're at the head, proceed to consume from the bucket
   *  - "waiting": someone else is the head and they're alive
   *  - "missing": your ticket isn't in the queue at all (e.g. queue list TTL
   *    expired); caller should re-enqueue or treat as enabled=false
   */
  async checkHead(
    provider: string,
    billingActorId: string,
    ticketId: string
  ): Promise<'head' | 'waiting' | 'missing'> {
    const redis = getRedisClient()
    if (!redis) {
      return 'head'
    }

    const listKey = queueListKey(provider, billingActorId)
    const hbPrefix = `hosted-queue-tkt:${provider}:${billingActorId}:`

    try {
      const result = (await redis.eval(CHECK_HEAD_SCRIPT, 1, listKey, hbPrefix, ticketId)) as
        | 'head'
        | 'waiting'
        | 'missing'
      return result
    } catch (error) {
      logger.warn(`Queue checkHead failed for ${listKey}`, { error: toError(error).message })
      // Fail-open: treat as head so the caller proceeds rather than hanging.
      return 'head'
    }
  }

  /**
   * Refresh the ticket's heartbeat so the head isn't reaped as dead while waiting on the
   * bucket. Also re-extends the queue list TTL so a wait outliving {@link QUEUE_LIST_TTL_SECONDS}
   * doesn't let the list expire and collapse FIFO ordering.
   */
  async refreshHeartbeat(
    provider: string,
    billingActorId: string,
    ticketId: string
  ): Promise<void> {
    const redis = getRedisClient()
    if (!redis) return

    const listKey = queueListKey(provider, billingActorId)
    const hbKey = heartbeatKey(provider, billingActorId, ticketId)
    try {
      const pipeline = redis.multi()
      pipeline.set(hbKey, '1', 'EX', TICKET_HEARTBEAT_TTL_SECONDS)
      pipeline.expire(listKey, QUEUE_LIST_TTL_SECONDS)
      await pipeline.exec()
    } catch (error) {
      logger.warn(`Queue heartbeat refresh failed for ${hbKey}`, {
        error: toError(error).message,
      })
    }
  }

  /**
   * Remove a ticket from the queue and its heartbeat key. Best-effort; safe to
   * call multiple times. LREM count=1 removes at most one matching entry.
   */
  async dequeue(provider: string, billingActorId: string, ticketId: string): Promise<void> {
    const redis = getRedisClient()
    if (!redis) return

    const listKey = queueListKey(provider, billingActorId)
    const hbKey = heartbeatKey(provider, billingActorId, ticketId)
    try {
      const pipeline = redis.multi()
      pipeline.lrem(listKey, 1, ticketId)
      pipeline.del(hbKey)
      await pipeline.exec()
    } catch (error) {
      logger.warn(`Queue dequeue failed for ${listKey}`, { error: toError(error).message })
    }
  }
}

let cachedQueue: HostedKeyQueue | null = null

export function getHostedKeyQueue(): HostedKeyQueue {
  if (!cachedQueue) {
    cachedQueue = new HostedKeyQueue()
  }
  return cachedQueue
}

export function resetHostedKeyQueue(): void {
  cachedQueue = null
}
