import { vi } from 'vitest'

interface MockUserLimits {
  usage?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Controllable mock functions for `@/app/api/v1/logs/meta`.
 *
 * Defaults:
 * - `mockGetUserLimits` resolves `{}` (the local stubs' shape; set a full `UserLimits` when the
 *   test reads it).
 * - `mockProjectUserLimits` is the real pure rule: `hideCostInfo` nulls `usage.currentPeriodCost`.
 * - `mockCreateApiResponse` is the real shape: `{ body: { ...data, limits }, headers }` with the
 *   `X-RateLimit-*` headers built from `apiRateLimit` (`{}` when it is omitted).
 *
 * @example
 * ```ts
 * import { v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
 *
 * v1LogsMetaMockFns.mockGetUserLimits.mockResolvedValue({
 *   usage: { currentPeriodCost: 4.25, limit: 50, plan: 'pro', isExceeded: false },
 * })
 * ```
 */
export const v1LogsMetaMockFns = {
  mockGetUserLimits: vi.fn(async (_userId: string): Promise<MockUserLimits> => ({})),
  mockProjectUserLimits: vi.fn(
    (limits: MockUserLimits, projection: { hideCostInfo?: boolean }): MockUserLimits =>
      projection.hideCostInfo
        ? { ...limits, usage: { ...limits.usage, currentPeriodCost: null } }
        : limits
  ),
  mockCreateApiResponse: vi.fn(
    (
      data: unknown,
      limits: unknown,
      apiRateLimit?: { limit: number; remaining: number; resetAt: Date }
    ) => ({
      body: { ...(data as object), limits },
      headers: (apiRateLimit
        ? {
            'X-RateLimit-Limit': apiRateLimit.limit.toString(),
            'X-RateLimit-Remaining': apiRateLimit.remaining.toString(),
            'X-RateLimit-Reset': apiRateLimit.resetAt.toISOString(),
          }
        : {}) as Record<string, string>,
    })
  ),
}

/**
 * Static mock module for `@/app/api/v1/logs/meta`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)
 * ```
 */
export const v1LogsMetaMock = {
  getUserLimits: v1LogsMetaMockFns.mockGetUserLimits,
  projectUserLimits: v1LogsMetaMockFns.mockProjectUserLimits,
  createApiResponse: v1LogsMetaMockFns.mockCreateApiResponse,
}
