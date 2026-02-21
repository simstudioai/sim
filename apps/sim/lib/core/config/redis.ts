import { createLogger } from '@sim/logger'
import Redis from 'ioredis'
import { env } from '@/lib/core/config/env'

const logger = createLogger('Redis')

const redisUrl = env.REDIS_URL

let globalRedisClient: Redis | null = null
let pingFailures = 0
let pingInterval: NodeJS.Timeout | null = null
let pingInFlight = false

const PING_INTERVAL_MS = 30_000
const MAX_PING_FAILURES = 3

/** Callbacks invoked when the PING health check forces a reconnect. */
const reconnectListeners: Array<() => void> = []

/**
 * Register a callback that fires when the PING health check forces a reconnect.
 * Useful for resetting cached adapters that hold a stale Redis reference.
 */
export function onRedisReconnect(cb: () => void): void {
  reconnectListeners.push(cb)
}

function startPingHealthCheck(redis: Redis): void {
  if (pingInterval) return

  pingInterval = setInterval(async () => {
    if (pingInFlight) return
    pingInFlight = true
    try {
      await redis.ping()
      pingFailures = 0
    } catch (error) {
      pingFailures++
      logger.warn('Redis PING failed', {
        consecutiveFailures: pingFailures,
        error: error instanceof Error ? error.message : String(error),
      })

      if (pingFailures >= MAX_PING_FAILURES) {
        logger.error('Redis PING failed 3 consecutive times — forcing reconnect', {
          consecutiveFailures: pingFailures,
        })
        pingFailures = 0
        for (const cb of reconnectListeners) {
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
      pingInFlight = false
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
  if (!redisUrl) return null
  if (globalRedisClient) return globalRedisClient

  try {
    logger.info('Initializing Redis client')

    globalRedisClient = new Redis(redisUrl, {
      keepAlive: 1000,
      connectTimeout: 10000,
      commandTimeout: 5000,
      maxRetriesPerRequest: 5,
      enableOfflineQueue: true,

      retryStrategy: (times) => {
        if (times > 10) {
          logger.error(`Redis reconnection attempt ${times}`, { nextRetryMs: 30000 })
          return 30000
        }
        const base = Math.min(1000 * 2 ** (times - 1), 10000)
        const jitter = Math.random() * base * 0.3
        const delay = Math.round(base + jitter)
        logger.warn('Redis reconnecting', { attempt: times, nextRetryMs: delay })
        return delay
      },

      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']
        return targetErrors.some((e) => err.message.includes(e))
      },
    })

    globalRedisClient.on('connect', () => logger.info('Redis connected'))
    globalRedisClient.on('ready', () => logger.info('Redis ready'))
    globalRedisClient.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message, code: (err as any).code })
    })
    globalRedisClient.on('close', () => logger.warn('Redis connection closed'))
    globalRedisClient.on('end', () => logger.error('Redis connection ended'))

    startPingHealthCheck(globalRedisClient)

    return globalRedisClient
  } catch (error) {
    logger.error('Failed to initialize Redis client', { error })
    return null
  }
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
 * Acquire a distributed lock using Redis SET NX.
 * Returns true if lock acquired, false if already held.
 *
 * When Redis is not available, returns true (lock "acquired") to allow
 * single-replica deployments to function without Redis. In multi-replica
 * deployments without Redis, the idempotency layer prevents duplicate processing.
 */
export async function acquireLock(
  lockKey: string,
  value: string,
  expirySeconds: number
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return true // No-op when Redis unavailable; idempotency layer handles duplicates
  }

  const result = await redis.set(lockKey, value, 'EX', expirySeconds, 'NX')
  return result === 'OK'
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
 * Close the Redis connection.
 * Use for graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (pingInterval) {
    clearInterval(pingInterval)
    pingInterval = null
  }

  if (globalRedisClient) {
    try {
      await globalRedisClient.quit()
    } catch (error) {
      logger.error('Error closing Redis connection', { error })
    } finally {
      globalRedisClient = null
    }
  }
}
