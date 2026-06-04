import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/config/redis`.
 * Default: `getRedisClient` returns `null` (tests that need a client override it).
 * `acquireLock` defaults to succeeding (`true`); `releaseLock` defaults to `true`.
 *
 * @example
 * ```ts
 * import { redisConfigMockFns } from '@sim/testing'
 *
 * redisConfigMockFns.mockGetRedisClient.mockReturnValue(myFakeRedis)
 * ```
 */
export const redisConfigMockFns = {
  mockGetRedisClient: vi.fn().mockReturnValue(null),
  mockOnRedisReconnect: vi.fn(),
  mockAcquireLock: vi.fn().mockResolvedValue(true),
  mockReleaseLock: vi.fn().mockResolvedValue(true),
  mockExtendLock: vi.fn().mockResolvedValue(true),
  mockCloseRedisConnection: vi.fn().mockResolvedValue(undefined),
  mockResetForTesting: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/config/redis`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/redis', () => redisConfigMock)
 * ```
 */
export const redisConfigMock = {
  getRedisClient: redisConfigMockFns.mockGetRedisClient,
  onRedisReconnect: redisConfigMockFns.mockOnRedisReconnect,
  acquireLock: redisConfigMockFns.mockAcquireLock,
  releaseLock: redisConfigMockFns.mockReleaseLock,
  extendLock: redisConfigMockFns.mockExtendLock,
  closeRedisConnection: redisConfigMockFns.mockCloseRedisConnection,
  resetForTesting: redisConfigMockFns.mockResetForTesting,
}
