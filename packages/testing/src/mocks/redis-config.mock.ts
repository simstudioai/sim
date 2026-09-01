import { vi } from 'vitest'
import { envMockFns } from './env.mock'

/**
 * Mirrors the real `resolveRedisTlsOptions`: `rediss://` URLs targeting a raw
 * IPv4 host require `REDIS_TLS_SERVERNAME` (cert hostname verification cannot
 * match an IP) and yield a `tls.servername`; DNS hosts and plain `redis://`
 * URLs add no TLS options.
 */
function resolveTlsOptionsImpl(url: string | undefined): { servername: string } | undefined {
  if (!url) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'rediss:') return undefined
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) return undefined
  const servername = envMockFns.getEnv('REDIS_TLS_SERVERNAME')
  if (!servername) {
    throw new Error(
      'REDIS_TLS_SERVERNAME must be set when REDIS_URL targets an IP over rediss://. ' +
        'TLS cert hostname verification cannot match an IP — set REDIS_TLS_SERVERNAME ' +
        'to the DNS name the cert was issued for (the ElastiCache primary endpoint).'
    )
  }
  return { servername }
}

function getRedisConnectionDefaultsImpl(url?: string): {
  keepAlive: number
  connectTimeout: number
  enableOfflineQueue: boolean
  tls?: { servername: string }
} {
  const tls = resolveTlsOptionsImpl(url)
  return {
    keepAlive: 1000,
    connectTimeout: 10000,
    enableOfflineQueue: true,
    ...(tls ? { tls } : {}),
  }
}

/**
 * Mirrors the real `describeRedisConnection` under its Redis-unavailable
 * default: no client, no lifecycle history, and nothing derivable from an
 * unset REDIS_URL.
 */
function describeRedisConnectionImpl() {
  return {
    status: 'no-client',
    clientAgeMs: null,
    readyAgeMs: null,
    msSinceLastPingOk: null,
    connects: 0,
    reconnects: 0,
    errors: 0,
    lastErrorMessage: null,
    hostKind: 'unknown' as const,
    tls: false,
    sniOverride: false,
  }
}

/**
 * Controllable mock functions for `@/lib/core/config/redis`.
 * Default: `getConfiguredRedisUrl` and `getRedisClient` return `null` (tests
 * that need Redis override them), matching the real module's database-cache
 * behavior.
 * `acquireLock`/`releaseLock`/`extendLock` default to succeeding (`true`),
 * matching the real module's Redis-unavailable no-op path.
 * {@link resetRedisConfigMock} restores the default behaviors.
 *
 * @example
 * ```ts
 * import { redisConfigMockFns } from '@sim/testing'
 *
 * redisConfigMockFns.mockGetRedisClient.mockReturnValue(myFakeRedis)
 * ```
 */
export const redisConfigMockFns = {
  mockGetConfiguredRedisUrl: vi.fn().mockReturnValue(null),
  mockGetRedisClient: vi.fn().mockReturnValue(null),
  mockGetRedisConnectionDefaults: vi.fn(getRedisConnectionDefaultsImpl),
  mockOnRedisReconnect: vi.fn(),
  mockAcquireLock: vi.fn().mockResolvedValue(true),
  mockReleaseLock: vi.fn().mockResolvedValue(true),
  mockExtendLock: vi.fn().mockResolvedValue(true),
  mockCloseRedisConnection: vi.fn().mockResolvedValue(undefined),
  mockResetForTesting: vi.fn(),
  mockDescribeRedisConnection: vi.fn(describeRedisConnectionImpl),
}

/**
 * Restores every redis-config mock function to its default behavior.
 */
export function resetRedisConfigMock(): void {
  redisConfigMockFns.mockGetConfiguredRedisUrl.mockReset().mockReturnValue(null)
  redisConfigMockFns.mockGetRedisClient.mockReset().mockReturnValue(null)
  redisConfigMockFns.mockGetRedisConnectionDefaults
    .mockReset()
    .mockImplementation(getRedisConnectionDefaultsImpl)
  redisConfigMockFns.mockOnRedisReconnect.mockReset()
  redisConfigMockFns.mockAcquireLock.mockReset().mockResolvedValue(true)
  redisConfigMockFns.mockReleaseLock.mockReset().mockResolvedValue(true)
  redisConfigMockFns.mockExtendLock.mockReset().mockResolvedValue(true)
  redisConfigMockFns.mockCloseRedisConnection.mockReset().mockResolvedValue(undefined)
  redisConfigMockFns.mockResetForTesting.mockReset()
  redisConfigMockFns.mockDescribeRedisConnection
    .mockReset()
    .mockImplementation(describeRedisConnectionImpl)
}

/**
 * Complete mock module for `@/lib/core/config/redis`, installed globally in
 * `apps/sim/vitest.setup.ts`. Every export of the real module is present.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/redis', () => redisConfigMock)
 * ```
 */
export const redisConfigMock = {
  getConfiguredRedisUrl: redisConfigMockFns.mockGetConfiguredRedisUrl,
  getRedisClient: redisConfigMockFns.mockGetRedisClient,
  getRedisConnectionDefaults: redisConfigMockFns.mockGetRedisConnectionDefaults,
  onRedisReconnect: redisConfigMockFns.mockOnRedisReconnect,
  acquireLock: redisConfigMockFns.mockAcquireLock,
  releaseLock: redisConfigMockFns.mockReleaseLock,
  extendLock: redisConfigMockFns.mockExtendLock,
  closeRedisConnection: redisConfigMockFns.mockCloseRedisConnection,
  resetForTesting: redisConfigMockFns.mockResetForTesting,
  describeRedisConnection: redisConfigMockFns.mockDescribeRedisConnection,
}
