import { vi } from 'vitest'

/**
 * Creates a mock Redis client with common operations.
 *
 * @example
 * ```ts
 * const redis = createMockRedis()
 * const queue = new RedisJobQueue(redis as never)
 *
 * // After operations
 * expect(redis.hset).toHaveBeenCalled()
 * expect(redis.expire).toHaveBeenCalledWith('key', 86400)
 * ```
 */
export function createMockRedis() {
  /** Per-instance listener registry, so `emit` can drive the lifecycle events
   *  a real client emits. `on` stays a spy: tests read `on.mock.calls` to reach
   *  the handlers the client registered. */
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  return {
    // Hash operations
    hset: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue(null),
    hgetall: vi.fn().mockResolvedValue({}),
    hdel: vi.fn().mockResolvedValue(1),
    hmset: vi.fn().mockResolvedValue('OK'),
    hincrby: vi.fn().mockResolvedValue(1),

    // Key operations
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),

    // List operations
    lpush: vi.fn().mockResolvedValue(1),
    rpush: vi.fn().mockResolvedValue(1),
    lpop: vi.fn().mockResolvedValue(null),
    rpop: vi.fn().mockResolvedValue(null),
    lrange: vi.fn().mockResolvedValue([]),
    llen: vi.fn().mockResolvedValue(0),

    // Set operations
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    sismember: vi.fn().mockResolvedValue(0),

    // Pub/Sub
    publish: vi.fn().mockResolvedValue(0),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const existing = listeners.get(event)
      if (existing) existing.add(listener)
      else listeners.set(event, new Set([listener]))
    }),
    removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener)
    }),
    /** Drives the lifecycle events a real client emits (`connect`, `ready`, `error`). */
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const registered = listeners.get(event)
      if (!registered?.size) return false
      // Copy first: a listener may remove itself while the event is dispatching.
      for (const listener of [...registered]) listener(...args)
      return true
    }),

    // Transaction
    multi: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
    })),

    // Scripting
    eval: vi.fn().mockResolvedValue(0),

    // Connection
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn().mockResolvedValue(undefined),

    // Status
    status: 'ready',
  }
}

export type MockRedis = ReturnType<typeof createMockRedis>

/**
 * Clears all Redis mock calls.
 */
export function clearRedisMocks(redis: MockRedis) {
  Object.values(redis).forEach((value) => {
    if (typeof value === 'function' && 'mockClear' in value) {
      value.mockClear()
    }
  })
}
