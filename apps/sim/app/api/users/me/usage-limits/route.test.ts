/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkServerSideUsageLimits: vi.fn(),
  getHighestPrioritySubscription: vi.fn(),
  getRateLimitStatusWithSubscription: vi.fn(),
  getUserStorageLimit: vi.fn(),
  getUserStorageUsage: vi.fn(),
}))

vi.mock('@/lib/billing', () => ({
  checkServerSideUsageLimits: mocks.checkServerSideUsageLimits,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mocks.getHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/storage', () => ({
  getUserStorageLimit: mocks.getUserStorageLimit,
  getUserStorageUsage: mocks.getUserStorageUsage,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    getRateLimitStatusWithSubscription = mocks.getRateLimitStatusWithSubscription
  },
}))

import { GET } from '@/app/api/users/me/usage-limits/route'

const SYNC_RESET_AT = new Date('2026-08-11T12:00:00.000Z')
const ASYNC_RESET_AT = new Date('2026-08-11T12:01:00.000Z')
const SUBSCRIPTION = { plan: 'pro' }

describe('GET /api/users/me/usage-limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mocks.getHighestPrioritySubscription.mockResolvedValue(SUBSCRIPTION)
    mocks.getRateLimitStatusWithSubscription
      .mockResolvedValueOnce({
        requestsPerMinute: 100,
        maxBurst: 200,
        remaining: 99,
        resetAt: SYNC_RESET_AT,
      })
      .mockResolvedValueOnce({
        requestsPerMinute: 50,
        maxBurst: 100,
        remaining: 0,
        resetAt: ASYNC_RESET_AT,
      })
    mocks.checkServerSideUsageLimits.mockResolvedValue({ currentUsage: 12.5, limit: 100 })
    mocks.getUserStorageUsage.mockResolvedValue(250)
    mocks.getUserStorageLimit.mockResolvedValue(1_000)
  })

  it('preserves the complete legacy response for session callers', async () => {
    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      rateLimit: {
        sync: {
          isLimited: false,
          requestsPerMinute: 100,
          maxBurst: 200,
          remaining: 99,
          resetAt: SYNC_RESET_AT.toISOString(),
        },
        async: {
          isLimited: true,
          requestsPerMinute: 50,
          maxBurst: 100,
          remaining: 0,
          resetAt: ASYNC_RESET_AT.toISOString(),
        },
        authType: 'manual',
      },
      usage: {
        currentPeriodCost: 12.5,
        limit: 100,
        plan: 'pro',
      },
      storage: {
        usedBytes: 250,
        limitBytes: 1_000,
        percentUsed: 25,
      },
    })
    expect(mocks.getRateLimitStatusWithSubscription).toHaveBeenNthCalledWith(
      1,
      'user-1',
      SUBSCRIPTION,
      'manual',
      false
    )
    expect(mocks.getRateLimitStatusWithSubscription).toHaveBeenNthCalledWith(
      2,
      'user-1',
      SUBSCRIPTION,
      'manual',
      true
    )
  })

  it('reports API key callers as API traffic', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
    })

    const response = await GET(createMockRequest('GET'))
    const body = await response.json()

    expect(body.rateLimit.authType).toBe('api')
    expect(mocks.getRateLimitStatusWithSubscription).toHaveBeenNthCalledWith(
      1,
      'user-1',
      SUBSCRIPTION,
      'api',
      false
    )
  })

  it('returns 401 before reading usage data when authentication fails', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({ success: false })

    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(401)
    expect(mocks.getHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(mocks.getRateLimitStatusWithSubscription).not.toHaveBeenCalled()
    expect(mocks.checkServerSideUsageLimits).not.toHaveBeenCalled()
  })
})
