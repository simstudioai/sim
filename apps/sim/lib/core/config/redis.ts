import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { randomFloat } from '@sim/utils/random'
import Redis, { type RedisOptions } from 'ioredis'
import { env } from '@/lib/core/config/env'
import { getConfiguredCacheProvider } from '@/lib/core/config/env-capabilities.server'

const logger = createLogger('Redis')

/**
 * When REDIS_URL targets a bare IP over `rediss://` (e.g. trigger.dev's
 * PrivateLink VPCE IP), default TLS hostname verification fails — the cert
 * is issued for the ElastiCache DNS name, not the IP. Override SNI with
 * REDIS_TLS_SERVERNAME (set to the DNS the cert was issued for).
 *
 * For DNS hosts: no override needed, default verification works.
 */
function resolveRedisTlsOptions(url: string | undefined): { servername: string } | undefined {
  if (!url) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'rediss:') return undefined
  const hostIsIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)
  if (!hostIsIp) return undefined
  if (!env.REDIS_TLS_SERVERNAME) {
    throw new Error(
      'REDIS_TLS_SERVERNAME must be set when REDIS_URL targets an IP over rediss://. ' +
        'TLS cert hostname verification cannot match an IP — set REDIS_TLS_SERVERNAME ' +
        'to the DNS name the cert was issued for (the ElastiCache primary endpoint).'
    )
  }
  return { servername: env.REDIS_TLS_SERVERNAME }
}

const REDIS_CONNECT_TIMEOUT_MS = 10_000

/**
 * Per-command deadline. MUST stay greater than `REDIS_CONNECT_TIMEOUT_MS`.
 *
 * `sendCommand` arms this timer *before* it checks whether the socket is
 * writable and before the `enableOfflineQueue` branch, so a command issued
 * while the connection is still being established is already counting down
 * while it waits in the offline queue. Set below the connect timeout, every
 * slow handshake surfaces as `Command timed out` — attributed to a Redis that
 * never received the command, with a stack containing only ioredis timer
 * frames.
 *
 * Production handshakes to ElastiCache measure 2-6s when several connections
 * are opened at once, so a 5s command timeout failed roughly 3% of cold-start
 * commands on Trigger.dev workers, which open a fresh connection per run.
 */
export const REDIS_COMMAND_TIMEOUT_MS = 15_000

/**
 * Shared connection defaults — keepAlive, connectTimeout, enableOfflineQueue,
 * and TLS SNI when REDIS_URL targets an IP. Every Redis client we open should
 * spread this; callers add their own retry policy on top and take their command
 * deadline from `REDIS_COMMAND_TIMEOUT_MS` so the invariant above holds.
 */
export function getRedisConnectionDefaults(
  url: string | undefined
): Pick<RedisOptions, 'keepAlive' | 'connectTimeout' | 'enableOfflineQueue' | 'tls'> {
  const tls = resolveRedisTlsOptions(url)
  return {
    keepAlive: 1000,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    enableOfflineQueue: true,
    ...(tls ? { tls } : {}),
  }
}

interface RedisState {
  client: Redis | null
  pingFailures: number
  pingInterval: NodeJS.Timeout | null
  pingInFlight: boolean
  reconnectListeners: Array<() => void>
  warmPromise: Promise<void> | null
}

const g = globalThis as typeof globalThis & { _redisState?: RedisState }
if (!g._redisState) {
  g._redisState = {
    client: null,
    pingFailures: 0,
    pingInterval: null,
    pingInFlight: false,
    reconnectListeners: [],
    warmPromise: null,
  }
}
const state = g._redisState

const PING_INTERVAL_MS = 15_000
const MAX_PING_FAILURES = 2

/**
 * Deadline for a single health probe.
 *
 * A PING is only ever issued on an already-established connection, so unlike a
 * general command it is never waiting on a handshake and takes a much tighter
 * deadline. Keeping it independent of `REDIS_COMMAND_TIMEOUT_MS` is what stops
 * the wider command deadline from slowing failover: two consecutive misses
 * still force a reconnect within roughly two intervals.
 */
const REDIS_PING_TIMEOUT_MS = 5_000

/**
 * `commandTimeout` cannot express "probe deadline" separately from "command
 * deadline" — it is a single client-wide option — so the probe carries its own.
 */
async function pingWithDeadline(redis: Redis): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Redis PING deadline exceeded')),
          REDIS_PING_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function getConfiguredRedisUrl(): string | null {
  if (getConfiguredCacheProvider() === 'database') return null

  const redisUrl = env.REDIS_URL
  if (!redisUrl) {
    throw new Error('Cache capability selected Redis but REDIS_URL is missing')
  }
  return redisUrl
}

/**
 * Register a callback that fires when the PING health check forces a reconnect.
 * Useful for resetting cached adapters that hold a stale Redis reference.
 */
export function onRedisReconnect(cb: () => void): void {
  state.reconnectListeners.push(cb)
}

function startPingHealthCheck(redis: Redis): void {
  if (state.pingInterval) return

  state.pingInterval = setInterval(async () => {
    if (state.pingInFlight) return
    state.pingInFlight = true
    try {
      await pingWithDeadline(redis)
      state.pingFailures = 0
    } catch (error) {
      state.pingFailures++
      logger.warn('Redis PING failed', {
        consecutiveFailures: state.pingFailures,
        error: toError(error).message,
      })

      if (state.pingFailures >= MAX_PING_FAILURES) {
        logger.error('Redis PING failed consecutive times — forcing reconnect', {
          consecutiveFailures: state.pingFailures,
        })
        state.pingFailures = 0
        // Clear before notifying listeners — they may call getRedisClient() and must see the reset state.
        state.client = null
        // The next client is cold again, so let it be warmed before first use.
        state.warmPromise = null
        if (state.pingInterval) {
          clearInterval(state.pingInterval)
          state.pingInterval = null
        }
        for (const cb of state.reconnectListeners) {
          try {
            cb()
          } catch (cbError) {
            logger.error('Redis reconnect listener error', { error: cbError })
          }
        }
        try {
          redis.disconnect(true)
        } catch (disconnectError) {
          logger.error('Error during forced Redis disconnect', { error: disconnectError })
        }
      }
    } finally {
      state.pingInFlight = false
    }
  }, PING_INTERVAL_MS)
}

/**
 * Get a Redis client instance.
 * Uses connection pooling to reuse connections across requests.
 *
 * ioredis handles command queuing internally via `enableOfflineQueue` (default: true),
 * so commands are queued and executed once connected. No manual connection checks needed.
 */
export function getRedisClient(): Redis | null {
  if (typeof window !== 'undefined') return null
  const redisUrl = getConfiguredRedisUrl()
  if (!redisUrl) return null
  if (state.client) return state.client

  // Outside the try/catch so config errors aren't silently swallowed.
  const defaults = getRedisConnectionDefaults(redisUrl)

  try {
    logger.info('Initializing Redis client')

    state.client = new Redis(redisUrl, {
      ...defaults,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 5,

      retryStrategy: (times) => {
        if (times > 10) {
          logger.error(`Redis reconnection attempt ${times}`, { nextRetryMs: 30000 })
          return 30000
        }
        const base = Math.min(1000 * 2 ** (times - 1), 10000)
        const jitter = randomFloat() * base * 0.3
        const delay = Math.round(base + jitter)
        logger.warn('Redis reconnecting', { attempt: times, nextRetryMs: delay })
        return delay
      },

      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']
        return targetErrors.some((e) => err.message.includes(e))
      },
    })

    state.client.on('connect', () => logger.info('Redis connected'))
    state.client.on('ready', () => logger.info('Redis ready'))
    state.client.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message, code: (err as any).code })
    })
    state.client.on('close', () => logger.warn('Redis connection closed'))
    state.client.on('end', () => logger.error('Redis connection ended'))

    startPingHealthCheck(state.client)

    return state.client
  } catch (error) {
    logger.error('Failed to initialize Redis client', { error })
    return null
  }
}

/**
 * Establish the shared connection before the first command needs it.
 *
 * `commandTimeout` is a total deadline that starts the moment a command is
 * issued: ioredis arms it in `sendCommand` before it checks whether the socket
 * is writable, so the budget covers handshake and offline-queue wait as well as
 * execution. A process whose first command lands on a cold client therefore
 * spends most of that budget on the TLS handshake, which measures 2-6s against
 * ElastiCache when several connections open at once.
 *
 * Warming at process start moves that cost off the first command's clock, which
 * is the connection-reuse practice AWS recommends: establishing a TCP+TLS
 * connection is far more expensive than the commands that run over it, so it
 * should be paid once per process rather than once per unit of work.
 *
 * Best effort by design — resolves rather than rejects on failure, and is
 * bounded by the connect budget, so neither a degraded Redis nor a missing
 * configuration can stop a process from starting. Callers that skip warming
 * still work; they just pay the handshake on their first command as before.
 *
 * Memoized per client: a warm process returns immediately, and a forced
 * reconnect clears it so the replacement connection is warmed in turn.
 */
export function warmRedisConnection(): Promise<void> {
  if (state.warmPromise) return state.warmPromise

  let client: Redis | null
  try {
    client = getRedisClient()
  } catch (error) {
    logger.warn('Skipping Redis warm-up: client unavailable', {
      error: toError(error).message,
    })
    return Promise.resolve()
  }

  if (!client) return Promise.resolve()
  if (client.status === 'ready') return Promise.resolve()

  const startedAt = Date.now()
  state.warmPromise = new Promise<void>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const finish = (outcome: 'ready' | 'deadline') => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      client.off('ready', onReady)
      const elapsedMs = Date.now() - startedAt
      if (outcome === 'ready') {
        logger.info('Redis connection warmed', { elapsedMs })
      } else {
        logger.warn('Redis warm-up did not complete before its deadline', { elapsedMs })
      }
      resolve()
    }

    const onReady = () => finish('ready')

    /**
     * Only `ready` settles early. A transient `error` is followed by ioredis's
     * own retry, so resolving on it would hand back a still-cold client and
     * reintroduce the very race this removes; the deadline is the backstop.
     */
    timer = setTimeout(() => finish('deadline'), REDIS_CONNECT_TIMEOUT_MS)
    client.once('ready', onReady)
  })

  return state.warmPromise
}

/**
 * Lua script for safe lock release.
 * Only deletes the key if the value matches (ownership verification).
 * Returns 1 if deleted, 0 if not (value mismatch or key doesn't exist).
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

/**
 * Lua script for safe lock TTL extension.
 * Only refreshes the expiry if the value matches (ownership verification),
 * so a stale heartbeat from a prior owner cannot extend a lock currently
 * held by someone else after a TTL eviction.
 * Returns 1 if the TTL was extended, 0 if not (value mismatch or key gone).
 */
const EXTEND_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`

/**
 * Acquire a distributed lock using Redis SET NX.
 * Returns true if lock acquired, false if already held.
 *
 * When Redis is not available, returns true (lock "acquired") to allow
 * single-replica deployments to function without Redis. In multi-replica
 * deployments without Redis, the idempotency layer prevents duplicate processing.
 */
export interface AcquireLockOptions {
  /**
   * Release the lock this call may have taken when the SET itself rejects.
   *
   * A rejected SET does not mean the server declined it: `commandTimeout` gives
   * up client-side while the command can still reach Redis and take the lock,
   * leaving it held by a caller that never learned it won and so never releases
   * it. Every contender then skips until the TTL expires.
   *
   * Only opt in when BOTH hold, because the reclaim is unsafe otherwise:
   *
   * 1. `value` is unique to this holder. A value two holders can share — the
   *    copilot chat lock keys on a client-supplied `userMessageId` — makes the
   *    compare-and-delete match a lock another holder is actively using.
   * 2. A throw means the caller does no work. One that falls open and runs
   *    anyway (`withLeaderLock`, the MCP OAuth refresh mutex) would keep running
   *    while this frees its lock, admitting a second concurrent runner.
   */
  reclaimOnFailure?: boolean
}

export async function acquireLock(
  lockKey: string,
  value: string,
  expirySeconds: number,
  options?: AcquireLockOptions
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return true // No-op when Redis unavailable; idempotency layer handles duplicates
  }

  try {
    const result = await redis.set(lockKey, value, 'EX', expirySeconds, 'NX')
    return result === 'OK'
  } catch (error) {
    // Best effort, and the same compare-and-delete `releaseLock` runs on the
    // success path: it deletes only while `value` still owns the key. If Redis
    // is still unreachable the TTL stays the backstop, which is the behavior
    // without this cleanup.
    if (options?.reclaimOnFailure) {
      await releaseLock(lockKey, value).catch(() => {})
    }
    throw error
  }
}

/**
 * Release a distributed lock safely.
 * Only releases if the caller owns the lock (value matches).
 * Returns true if lock was released, false if not owned or already expired.
 *
 * When Redis is not available, returns true (no-op) since no lock was held.
 */
export async function releaseLock(lockKey: string, value: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return true // No-op when Redis unavailable; no lock was actually held
  }

  const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, value)
  return result === 1
}

/**
 * Extend the TTL of a distributed lock if still owned by the caller.
 * Returns true if the caller still owns the lock and the TTL was refreshed,
 * false if the lock has been taken over by another owner or has expired.
 *
 * When Redis is not available, returns true (no-op) to match the behavior
 * of `acquireLock` / `releaseLock`: single-replica deployments without
 * Redis never held a real lock, so heartbeat success is implicit.
 */
export async function extendLock(
  lockKey: string,
  value: string,
  expirySeconds: number
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return true
  }

  const result = await redis.eval(EXTEND_LOCK_SCRIPT, 1, lockKey, value, expirySeconds)
  return result === 1
}

/**
 * Close the Redis connection.
 * Use for graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (state.pingInterval) {
    clearInterval(state.pingInterval)
    state.pingInterval = null
  }

  if (state.client) {
    try {
      await state.client.quit()
    } catch (error) {
      logger.error('Error closing Redis connection', { error })
    } finally {
      state.client = null
    }
  }
}

/**
 * Reset all module-level state. Only intended for use in tests.
 */
export function resetForTesting(): void {
  if (state.pingInterval) {
    clearInterval(state.pingInterval)
    state.pingInterval = null
  }
  state.client = null
  state.pingFailures = 0
  state.pingInFlight = false
  state.warmPromise = null
  state.reconnectListeners.length = 0
}
