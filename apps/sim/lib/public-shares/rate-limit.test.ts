/**
 * @vitest-environment node
 */
import { requestUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'

describe('enforcePublicFileRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed without creating a shared bucket when the client IP cannot be resolved', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)

    const response = await enforcePublicFileRateLimit(new Request('http://localhost'), 'content')

    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBe('60')
    expect(mockCheckRateLimitDirect).not.toHaveBeenCalled()
  })
})
