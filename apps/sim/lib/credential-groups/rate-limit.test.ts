/**
 * @vitest-environment node
 */
import { createMockRequest, requestUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimitError: class extends Error {},
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import {
  enforcePublicCredentialGroupIpRateLimit,
  enforcePublicCredentialGroupOAuthStartIpRateLimit,
} from '@/lib/credential-groups/rate-limit'

describe('public credential group rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
