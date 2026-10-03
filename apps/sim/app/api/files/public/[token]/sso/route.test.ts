import { requestUtilsMockFns } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { publicSharesMock, publicSharesMockFns } from '@sim/testing/mocks/public-shares.mock'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEmailAllowed } = vi.hoisted(() => ({
  mockIsEmailAllowed: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => publicSharesMock)
vi.mock('@/lib/core/security/deployment', () => ({ isEmailAllowed: mockIsEmailAllowed }))
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)

import { POST } from '@/app/api/files/public/[token]/sso/route'

const { mockResolveActiveShareByToken } = publicSharesMockFns

const mockCheckRateLimitDirect = rateLimiterMockFns.mockCheckRateLimitDirect

const params = (token = 'tok_1') => createRouteContext({ token })
const post = (email: string, token = 'tok_1') =>
  createMockRequest({
    method: 'POST',
    url: `http://localhost/api/files/public/${token}/sso`,
    body: { email },
  })

const ssoShare = {
  share: { id: 'sh_1', authType: 'sso', password: null, allowedEmails: ['@acme.com'] },
  file: { originalName: 'report.pdf' },
}

describe('POST /api/files/public/[token]/sso', () => {
  beforeEach(() => {
    mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
    mockResolveActiveShareByToken.mockResolvedValue(ssoShare)
  })

  it('returns eligible:false for a non-listed email', async () => {
    mockIsEmailAllowed.mockReturnValueOnce(false)
    const res = await POST(post('user@evil.com'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ eligible: false })
  })

  it('returns 429 when rate-limited', async () => {
    mockCheckRateLimitDirect.mockResolvedValueOnce({ allowed: false, retryAfterMs: 2000 })
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('2')
  })

  it('uses the share resource limit when the client IP cannot be resolved', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)

    const res = await POST(post('user@acme.com'), params())

    expect(res.status).toBe(200)
    expect(mockCheckRateLimitDirect).toHaveBeenCalledTimes(1)
    expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
      'file-sso:resource:sh_1',
      expect.objectContaining({ maxTokens: 100 }),
      { failClosed: true }
    )
  })
})
