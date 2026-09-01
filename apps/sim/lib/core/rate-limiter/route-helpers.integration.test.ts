/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.unmock('@/lib/core/utils/request')

vi.mock('@/lib/core/config/env', () => ({
  env: { AUTH_TRUSTED_PROXIES: '10.0.0.0/8' },
}))

vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import { enforceIpRateLimit } from '@/lib/core/rate-limiter/route-helpers'

describe('route rate-limit client IP resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimitDirect.mockResolvedValue({
      allowed: true,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  })

  it('keys the bucket on the first untrusted hop from the right', async () => {
    const request = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '198.51.100.20, 203.0.113.30, 10.0.0.12',
      },
    })

    const response = await enforceIpRateLimit('public-bucket', request)

    expect(response).toBeNull()
    expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
      'route:public-bucket:ip:203.0.113.30',
      expect.objectContaining({ maxTokens: 10 })
    )
  })
})
