import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)

import { POST } from '@/app/api/desktop/source-connect/route'

it.each([true, false])(
  'rejects an oversized desktop request before JSON decoding (declared length: %s)',
  async (declaredLength) => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'fixture-user' },
      session: { id: 'fixture-session' },
    })
    rateLimiterMockFns.mockEnforceUserRateLimit.mockResolvedValueOnce(null)
    const rawBody = ' '.repeat(64 * 1024 + 1)
    const response = await POST(
      createMockRequest({
        method: 'POST',
        url: 'http://localhost/api/desktop/source-connect',
        rawBody,
        headers: {
          'content-type': 'application/json',
          ...(declaredLength ? { 'content-length': String(rawBody.length) } : {}),
        },
      })
    )
    expect(response.status).toBe(413)
  }
)
