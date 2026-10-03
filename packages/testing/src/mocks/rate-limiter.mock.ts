import { vi } from 'vitest'

interface MockTokenBucketConfig {
  maxTokens: number
  refillRate: number
  refillIntervalMs: number
}

type MockPlan = 'free' | 'pro' | 'team' | 'enterprise'

/** Per-minute rates the real module uses when no `RATE_LIMIT_*` env override is set. */
const DEFAULT_RATE_LIMITS = {
  free: { sync: 50, async: 200, apiEndpoint: 30 },
  pro: { sync: 150, async: 1000, apiEndpoint: 100 },
  team: { sync: 300, async: 2500, apiEndpoint: 200 },
  enterprise: { sync: 600, async: 5000, apiEndpoint: 500 },
} as const

/** Faithful copy of the real `toTokenBucketConfig`. */
function toTokenBucketConfig(
  limitPerMinute: number,
  burstMultiplier = 2,
  windowMs = 60000
): MockTokenBucketConfig {
  return {
    maxTokens: limitPerMinute * burstMultiplier,
    refillRate: limitPerMinute,
    refillIntervalMs: windowMs,
  }
}

function planLimits(plan: MockPlan) {
  const rates = DEFAULT_RATE_LIMITS[plan]
  return {
    sync: toTokenBucketConfig(rates.sync),
    async: toTokenBucketConfig(rates.async),
    apiEndpoint: toTokenBucketConfig(rates.apiEndpoint),
  }
}

/** Real per-plan bucket table under default env (60 s window, 2x burst). */
const RATE_LIMITS = {
  free: planLimits('free'),
  pro: planLimits('pro'),
  team: planLimits('team'),
  enterprise: planLimits('enterprise'),
}

/**
 * `RateLimitResult` with `remaining`/`resetAt` optional so overrides may return a partial
 * result (e.g. `{ allowed: false, retryAfterMs: 1_000 }`).
 */
interface MockRateLimitResult {
  allowed: boolean
  remaining?: number
  resetAt?: Date
  retryAfterMs?: number
}

interface MockRateLimitStatus {
  requestsPerMinute: number
  maxBurst: number
  remaining: number
  resetAt: Date
}

/** An admitted request: the default every `RateLimiter` check resolves to. */
function allowedResult(): MockRateLimitResult {
  return { allowed: true, remaining: 99, resetAt: new Date() }
}

/** Faithful copy of the real `RateLimitError`. */
class RateLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 429) {
    super(message)
    this.name = 'RateLimitError'
    this.statusCode = statusCode
  }
}

/**
 * Controllable mock functions for `@/lib/core/rate-limiter`.
 *
 * Every `RateLimiter` instance delegates to the SAME fns below, so a test steers the
 * limiter the route under test constructs internally. `mockRateLimiterConstructor`
 * records each `new RateLimiter(storage?)`. Defaults: every check admits
 * (`{ allowed: true, remaining: 99, resetAt: new Date() }`), `getRateLimit` returns
 * `{ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }`, every `enforce*` route
 * helper resolves `null` (proceed), and the hosted-key limiter's `acquireKey` /
 * `reportUsage` are bare `vi.fn()`s.
 *
 * @example
 * ```ts
 * import { rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
 *
 * rateLimiterMockFns.mockCheckRateLimitDirect.mockResolvedValueOnce({
 *   allowed: false,
 *   remaining: 0,
 *   resetAt: new Date(Date.now() + 60_000),
 * })
 * rateLimiterMockFns.mockEnforceUserRateLimit.mockResolvedValueOnce(
 *   NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
 * )
 * ```
 */
export const rateLimiterMockFns = {
  mockRateLimiterConstructor: vi.fn(),
  mockCheckRateLimitWithSubscription: vi.fn(
    async (
      _userId: string,
      _subscription?: unknown,
      _triggerType?: string,
      _isAsync?: boolean
    ): Promise<MockRateLimitResult> => allowedResult()
  ),
  mockCheckRateLimitWithSubscriptionOrThrow: vi.fn(
    async (
      _subjectId: string,
      _subscription?: unknown,
      _triggerType?: string,
      _isAsync?: boolean
    ): Promise<MockRateLimitResult> => allowedResult()
  ),
  mockGetRateLimitStatusWithSubscription: vi.fn(
    async (
      _userId: string,
      _subscription?: unknown,
      _triggerType?: string,
      _isAsync?: boolean
    ): Promise<MockRateLimitStatus> => ({
      requestsPerMinute: 50,
      maxBurst: 100,
      remaining: 99,
      resetAt: new Date(),
    })
  ),
  mockCheckRateLimitDirect: vi.fn(
    async (
      _storageKey: string,
      _config?: MockTokenBucketConfig,
      _options?: { failClosed?: boolean }
    ): Promise<MockRateLimitResult> => allowedResult()
  ),
  mockCheckRateLimitDirectOrThrow: vi.fn(
    async (_storageKey: string, _config?: MockTokenBucketConfig): Promise<MockRateLimitResult> =>
      allowedResult()
  ),
  mockResetRateLimit: vi.fn(async (_rateLimitKey: string): Promise<void> => undefined),
  mockGetRateLimit: vi.fn(
    (_plan?: string, _type?: string): MockTokenBucketConfig => ({
      maxTokens: 100,
      refillRate: 50,
      refillIntervalMs: 60_000,
    })
  ),
  mockEnforceUserRateLimit: vi.fn(
    async (
      _bucketName: string,
      _userId: string,
      _config?: MockTokenBucketConfig
    ): Promise<Response | null> => null
  ),
  mockEnforceIpRateLimit: vi.fn(
    async (
      _bucketName: string,
      _request: Request,
      _config?: MockTokenBucketConfig
    ): Promise<Response | null> => null
  ),
  mockEnforceIpRateLimitWithIndependentBackstop: vi.fn(
    async (
      _bucketName: string,
      _request: Request,
      _config?: MockTokenBucketConfig,
      _resourceId?: string
    ): Promise<Response | null> => null
  ),
  mockEnforceRecipientRateLimit: vi.fn(
    async (
      _bucketName: string,
      _email: string,
      _config?: MockTokenBucketConfig
    ): Promise<Response | null> => null
  ),
  mockEnforceResourceRateLimit: vi.fn(
    async (
      _bucketName: string,
      _resourceId: string,
      _config?: MockTokenBucketConfig
    ): Promise<Response | null> => null
  ),
  mockEnforceUserOrIpRateLimit: vi.fn(
    async (
      _bucketName: string,
      _userId: string | undefined,
      _request: Request,
      _config?: MockTokenBucketConfig
    ): Promise<Response | null> => null
  ),
  mockHostedKeyAcquireKey: vi.fn(),
  mockHostedKeyReportUsage: vi.fn(),
  mockGetHostedKeyRateLimiter: vi.fn(() => getHostedKeyRateLimiter()),
  mockResetHostedKeyRateLimiter: vi.fn(),
  mockToTokenBucketConfig: vi.fn(toTokenBucketConfig),
}

/** `RateLimiter` stand-in whose methods are the shared {@link rateLimiterMockFns}. */
class RateLimiter {
  constructor(storage?: unknown) {
    rateLimiterMockFns.mockRateLimiterConstructor(storage)
  }
  checkRateLimitWithSubscription = rateLimiterMockFns.mockCheckRateLimitWithSubscription
  checkRateLimitWithSubscriptionOrThrow =
    rateLimiterMockFns.mockCheckRateLimitWithSubscriptionOrThrow
  getRateLimitStatusWithSubscription = rateLimiterMockFns.mockGetRateLimitStatusWithSubscription
  checkRateLimitDirect = rateLimiterMockFns.mockCheckRateLimitDirect
  checkRateLimitDirectOrThrow = rateLimiterMockFns.mockCheckRateLimitDirectOrThrow
  resetRateLimit = rateLimiterMockFns.mockResetRateLimit
}

/** `HostedKeyRateLimiter` stand-in whose methods are the shared {@link rateLimiterMockFns}. */
class HostedKeyRateLimiter {
  acquireKey = rateLimiterMockFns.mockHostedKeyAcquireKey
  reportUsage = rateLimiterMockFns.mockHostedKeyReportUsage
}

let hostedKeyRateLimiter: HostedKeyRateLimiter | undefined

/** Process-wide singleton, mirroring the real `getHostedKeyRateLimiter`. */
function getHostedKeyRateLimiter(): HostedKeyRateLimiter {
  hostedKeyRateLimiter ??= new HostedKeyRateLimiter()
  return hostedKeyRateLimiter
}

/**
 * Static mock module for `@/lib/core/rate-limiter` (the barrel). Covers every runtime
 * export; see {@link rateLimiterMockFns} for defaults.
 *
 * The narrower `v1RateLimiterModuleMock` / `v2RateLimiterModuleMock` remain for route suites
 * that only need admission to pass.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
 * ```
 */
export const rateLimiterMock = {
  RateLimiter,
  RateLimitError,
  RATE_LIMITS,
  getRateLimit: rateLimiterMockFns.mockGetRateLimit,
  DEFAULT_USER_ROUTE_LIMIT: { maxTokens: 60, refillRate: 30, refillIntervalMs: 60_000 },
  DEFAULT_PUBLIC_IP_ROUTE_LIMIT: { maxTokens: 10, refillRate: 5, refillIntervalMs: 60_000 },
  enforceUserRateLimit: rateLimiterMockFns.mockEnforceUserRateLimit,
  enforceIpRateLimit: rateLimiterMockFns.mockEnforceIpRateLimit,
  enforceIpRateLimitWithIndependentBackstop:
    rateLimiterMockFns.mockEnforceIpRateLimitWithIndependentBackstop,
  enforceRecipientRateLimit: rateLimiterMockFns.mockEnforceRecipientRateLimit,
  enforceResourceRateLimit: rateLimiterMockFns.mockEnforceResourceRateLimit,
  enforceUserOrIpRateLimit: rateLimiterMockFns.mockEnforceUserOrIpRateLimit,
  HostedKeyRateLimiter,
  getHostedKeyRateLimiter: rateLimiterMockFns.mockGetHostedKeyRateLimiter,
  resetHostedKeyRateLimiter: rateLimiterMockFns.mockResetHostedKeyRateLimiter,
  toTokenBucketConfig: rateLimiterMockFns.mockToTokenBucketConfig,
  DEFAULT_WINDOW_MS: 60000,
  DEFAULT_BURST_MULTIPLIER: 2,
}
