import { vi } from 'vitest'

/**
 * Faithful stand-in for `V2ApiKeyUnauthenticatedError`: same name, default message, and
 * `challenge` field, so `instanceof` checks and challenge-header projection behave like production.
 */
export class MockV2ApiKeyUnauthenticatedError extends Error {
  constructor(
    message = 'Invalid API key',
    readonly challenge: 'api_key' | 'bearer' = 'api_key'
  ) {
    super(message)
    this.name = 'V2ApiKeyUnauthenticatedError'
  }
}

/**
 * Shared knobs for the v2 route modules: `authenticate` backs `authenticateV2ApiKey`,
 * `preauthRate` backs `RateLimiter#checkRateLimitDirect`, `operationRate` backs
 * `RateLimiter#checkRateLimitDirectOrThrow`.
 */
export const v2RouteMocks = {
  authenticate: vi.fn(),
  operationRate: vi.fn(),
  preauthRate: vi.fn(),
}

/**
 * Static mock module for `@/lib/api/server/routes/v2-api-key-auth` (covers every runtime export).
 *
 * @example
 * ```ts
 * vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
 * v2RouteMocks.authenticate.mockResolvedValue({ principal, rateLimitSubjectIds: ['user:u1'], ... })
 * ```
 */
export const v2ApiKeyAuthModuleMock = {
  authenticateV2ApiKey: v2RouteMocks.authenticate,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}

export const v2RateLimiterModuleMock = {
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = v2RouteMocks.preauthRate
    checkRateLimitDirectOrThrow = v2RouteMocks.operationRate
  },
}

export const V2_PREAUTH_RATE_LIMIT_ALLOWED = {
  allowed: true,
  remaining: 599,
  resetAt: new Date('2026-01-01T01:00:00.000Z'),
} as const

export const V2_OPERATION_RATE_LIMIT_ALLOWED = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00.000Z'),
} as const
