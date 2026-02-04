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
    on: vi.fn(),

    // Transaction
    multi: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
    })),

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
