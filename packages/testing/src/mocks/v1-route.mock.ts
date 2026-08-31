import { vi } from 'vitest'

/**
 * Ambient request-admission modules for the v1 public API.
 *
 * `app/api/v1/middleware.ts` consults a subscription, a rate bucket, and the
 * rate-limit snapshot context on the way into every handler. A suite whose
 * subject is what the handler does — a capability gate, a field projection —
 * needs all three to pass, and needs none of them to be controllable. These
 * pass-through module mocks say exactly that, so the per-suite `vi.mock` block
 * is left with only the seams the suite actually steers.
 *
 * Use `@/app/api/v1/middleware`'s own mocks instead when admission itself is
 * the subject; these deliberately expose no handles to assert on.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/subscription', () => v1SubscriptionModuleMock)
 * vi.mock('@/lib/core/rate-limiter', () => v1RateLimiterModuleMock)
 * vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
 * ```
 */
export const v1SubscriptionModuleMock = {
  getHighestPrioritySubscription: vi.fn(async () => null),
}

/** Always-allowed bucket, so admission never decides a v1 test's outcome. */
export const v1RateLimiterModuleMock = {
  RateLimiter: class RateLimiter {
    checkRateLimitWithSubscription() {
      return Promise.resolve({ allowed: true, remaining: 100, resetAt: new Date() })
    }
  },
  getRateLimit: () => ({ maxTokens: 200 }),
}

/** Header plumbing the routes call unconditionally; it emits nothing to assert. */
export const v1RateLimitContextModuleMock = {
  buildRateLimitHeaders: () => ({}),
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: () => null,
}
