import { vi } from 'vitest'

export class MockV2ApiKeyUnauthenticatedError extends Error {
  constructor(message = 'Invalid API key') {
    super(message)
    this.name = 'V2ApiKeyUnauthenticatedError'
  }
}

export const v2RouteMocks = {
  authenticate: vi.fn(),
  gate: vi.fn(),
  operationRate: vi.fn(),
  preauthRate: vi.fn(),
}

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

export const v2GateModuleMock = { v2ApiGateError: v2RouteMocks.gate }

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
