/**
 * @vitest-environment node
 */
import { requestUtilsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveActiveShareByToken, mockIsEmailAllowed, mockCheckRateLimitDirect } = vi.hoisted(
  () => ({
    mockResolveActiveShareByToken: vi.fn(),
    mockIsEmailAllowed: vi.fn(),
    mockCheckRateLimitDirect: vi.fn(),
  })
)

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mockResolveActiveShareByToken,
}))
vi.mock('@/lib/core/security/deployment', () => ({ isEmailAllowed: mockIsEmailAllowed }))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import { POST } from '@/app/api/files/public/[token]/sso/route'

const params = (token = 'tok_1') => ({ params: Promise.resolve({ token }) })
const post = (email: string, token = 'tok_1') =>
  new NextRequest(`http://localhost/api/files/public/${token}/sso`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })

const ssoShare = {
  share: { id: 'sh_1', authType: 'sso', password: null, allowedEmails: ['@acme.com'] },
  file: { originalName: 'report.pdf' },
}

describe('POST /api/files/public/[token]/sso', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
    mockResolveActiveShareByToken.mockResolvedValue(ssoShare)
  })

  it('returns eligible:true for an allow-listed email', async () => {
    mockIsEmailAllowed.mockReturnValueOnce(true)
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ eligible: true })
    expect(mockCheckRateLimitDirect).toHaveBeenNthCalledWith(
      1,
      'file-sso:ip:127.0.0.1',
      expect.objectContaining({ maxTokens: 20 }),
      { failClosed: true }
    )
    expect(mockCheckRateLimitDirect).toHaveBeenNthCalledWith(
      2,
      'file-sso:resource:sh_1',
      expect.objectContaining({ maxTokens: 100 }),
      { failClosed: true }
    )
  })

  it('returns eligible:false for a non-listed email', async () => {
    mockIsEmailAllowed.mockReturnValueOnce(false)
    const res = await POST(post('user@evil.com'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ eligible: false })
  })

  it('rejects a non-sso share with 400', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce({
      ...ssoShare,
      share: { ...ssoShare.share, authType: 'email' },
    })
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown token', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce(null)
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(404)
  })

  it('returns 429 when rate-limited', async () => {
    mockCheckRateLimitDirect.mockResolvedValueOnce({ allowed: false, retryAfterMs: 2000 })
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('2')
  })

  it('returns 429 when the share resource limit is exceeded', async () => {
    mockCheckRateLimitDirect
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 3000 })

    const res = await POST(post('user@acme.com'), params())

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('3')
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
