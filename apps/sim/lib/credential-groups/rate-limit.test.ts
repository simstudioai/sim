import { createMockRequest, requestUtilsMockFns } from '@sim/testing'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
const mockCheckRateLimitDirect = rateLimiterMockFns.mockCheckRateLimitDirect

import {
  enforcePublicCredentialGroupIpRateLimit,
  enforcePublicCredentialGroupOAuthStartIpRateLimit,
} from '@/lib/credential-groups/rate-limit'

describe('public credential group rate limits', () => {
  it('fails closed without a client IP when no independent backstop is declared', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)

    const response = await enforcePublicCredentialGroupIpRateLimit(
      createMockRequest('GET'),
      'metadata'
    )

    expect(response?.status).toBe(429)
    expect(mockCheckRateLimitDirect).not.toHaveBeenCalled()
  })

  it('defers unresolved OAuth clients to the per-enrollment backstop', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)

    const response = await enforcePublicCredentialGroupOAuthStartIpRateLimit(
      createMockRequest('GET')
    )

    expect(response).toBeNull()
    expect(mockCheckRateLimitDirect).not.toHaveBeenCalled()
  })
})
