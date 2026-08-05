/**
 * @vitest-environment node
 *
 * Both halves of the email gate live here: POST issues a code, PUT exchanges it
 * for an `interface_auth_{shareId}` cookie. PUT carries its own IP bucket so a
 * failed verify never consumes the send allowance.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveActiveInterfaceShareByToken,
  mockIsEmailAllowed,
  mockSetDeploymentAuthCookie,
  mockGenerateOTP,
  mockStoreOTP,
  mockGetOTP,
  mockDeleteOTP,
  mockIncrementOTPAttempts,
  mockDecodeOTPValue,
  mockRenderOTPEmail,
  mockSendEmail,
  mockCheckRateLimitDirect,
} = vi.hoisted(() => ({
  mockResolveActiveInterfaceShareByToken: vi.fn(),
  mockIsEmailAllowed: vi.fn(),
  mockSetDeploymentAuthCookie: vi.fn(),
  mockGenerateOTP: vi.fn(),
  mockStoreOTP: vi.fn(),
  mockGetOTP: vi.fn(),
  mockDeleteOTP: vi.fn(),
  mockIncrementOTPAttempts: vi.fn(),
  mockDecodeOTPValue: vi.fn(),
  mockRenderOTPEmail: vi.fn(),
  mockSendEmail: vi.fn(),
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveInterfaceShareByToken: mockResolveActiveInterfaceShareByToken,
}))
vi.mock('@/lib/core/security/deployment', () => ({
  isEmailAllowed: mockIsEmailAllowed,
  setDeploymentAuthCookie: mockSetDeploymentAuthCookie,
}))
vi.mock('@/lib/core/security/otp', () => ({
  generateOTP: mockGenerateOTP,
  storeOTP: mockStoreOTP,
  getOTP: mockGetOTP,
  deleteOTP: mockDeleteOTP,
  incrementOTPAttempts: mockIncrementOTPAttempts,
  decodeOTPValue: mockDecodeOTPValue,
  MAX_OTP_ATTEMPTS: 5,
  OTP_IP_RATE_LIMIT: { maxTokens: 10, refillRate: 10, refillIntervalMs: 1000 },
  OTP_EMAIL_RATE_LIMIT: { maxTokens: 3, refillRate: 3, refillIntervalMs: 1000 },
}))
vi.mock('@/components/emails', () => ({ renderOTPEmail: mockRenderOTPEmail }))
vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: mockSendEmail }))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import { POST, PUT } from '@/app/api/interfaces/public/[token]/otp/route'

const TOKEN = 'tok_1'

const params = (token = TOKEN) => ({ params: Promise.resolve({ token }) })

const post = (email: string, token = TOKEN) =>
  new NextRequest(`http://localhost/api/interfaces/public/${token}/otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })

const put = (email: string, otp: string, token = TOKEN) =>
  new NextRequest(`http://localhost/api/interfaces/public/${token}/otp`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  })

const emailShare = {
  share: { id: 'sh_1', authType: 'email', password: null, allowedEmails: ['@acme.com'] },
  definition: { id: 'int-1', name: 'Confidential desk' },
  workspaceId: 'ws-secret',
}

describe('POST /api/interfaces/public/[token]/otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
    mockResolveActiveInterfaceShareByToken.mockResolvedValue(emailShare)
    mockIsEmailAllowed.mockReturnValue(true)
    mockGenerateOTP.mockReturnValue('123456')
    mockRenderOTPEmail.mockResolvedValue('<html/>')
    mockSendEmail.mockResolvedValue({ success: true })
  })

  it('sends a code to an allow-listed email', async () => {
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(200)
    expect(mockStoreOTP).toHaveBeenCalledWith('interface', 'sh_1', 'user@acme.com', '123456')
    expect(mockSendEmail).toHaveBeenCalled()
  })

  it('lowercases the email for allow-list matching and OTP storage', async () => {
    await POST(post('User@ACME.com'), params())
    expect(mockIsEmailAllowed).toHaveBeenCalledWith('user@acme.com', ['@acme.com'])
    expect(mockStoreOTP).toHaveBeenCalledWith('interface', 'sh_1', 'user@acme.com', '123456')
  })

  it('rejects an email not on the allow-list with 403', async () => {
    mockIsEmailAllowed.mockReturnValueOnce(false)
    const res = await POST(post('user@evil.com'), params())
    expect(res.status).toBe(403)
    expect(mockStoreOTP).not.toHaveBeenCalled()
  })

  it('rejects a non-email share with 400', async () => {
    mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce({
      ...emailShare,
      share: { ...emailShare.share, authType: 'password' },
    })
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(400)
  })

  it('returns 429 with Retry-After when the IP rate limit is exceeded', async () => {
    mockCheckRateLimitDirect.mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 })
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1')
    expect(mockResolveActiveInterfaceShareByToken).not.toHaveBeenCalled()
  })

  it('meters the send bucket, not the verify bucket', async () => {
    await POST(post('user@acme.com'), params())
    expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
      'interface-otp:ip:127.0.0.1',
      expect.anything()
    )
  })
})

describe('PUT /api/interfaces/public/[token]/otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
    mockResolveActiveInterfaceShareByToken.mockResolvedValue(emailShare)
    mockGetOTP.mockResolvedValue('123456:0')
    mockDecodeOTPValue.mockReturnValue({ otp: '123456', attempts: 0 })
  })

  it('verifies a correct code, sets the cookie, returns authType', async () => {
    const res = await PUT(put('user@acme.com', '123456'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authType: 'email' })
    expect(mockDeleteOTP).toHaveBeenCalledWith('interface', 'sh_1', 'user@acme.com')
    expect(mockSetDeploymentAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
      'interface',
      'sh_1',
      'email',
      null
    )
  })

  it('rejects a wrong code with 400 and increments attempts', async () => {
    mockIncrementOTPAttempts.mockResolvedValueOnce('incremented')
    const res = await PUT(put('user@acme.com', '000000'), params())
    expect(res.status).toBe(400)
    expect(mockIncrementOTPAttempts).toHaveBeenCalledWith(
      'interface',
      'sh_1',
      'user@acme.com',
      '123456:0'
    )
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('returns 429 when attempts are exhausted on a wrong code', async () => {
    mockIncrementOTPAttempts.mockResolvedValueOnce('locked')
    const res = await PUT(put('user@acme.com', '000000'), params())
    expect(res.status).toBe(429)
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('locks out and clears the code once the stored attempt count is at the max', async () => {
    mockDecodeOTPValue.mockReturnValueOnce({ otp: '123456', attempts: 5 })
    const res = await PUT(put('user@acme.com', '123456'), params())
    expect(res.status).toBe(429)
    expect(mockDeleteOTP).toHaveBeenCalledWith('interface', 'sh_1', 'user@acme.com')
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('returns 400 when no code was issued', async () => {
    mockGetOTP.mockResolvedValueOnce(null)
    const res = await PUT(put('user@acme.com', '123456'), params())
    expect(res.status).toBe(400)
  })

  it('returns 429 with Retry-After when the verify IP rate limit is exceeded', async () => {
    mockCheckRateLimitDirect.mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 })
    const res = await PUT(put('user@acme.com', '123456'), params())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1')
    expect(mockResolveActiveInterfaceShareByToken).not.toHaveBeenCalled()
    expect(mockGetOTP).not.toHaveBeenCalled()
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('meters verify on its own bucket so a resend is not throttled by failed verifies', async () => {
    await PUT(put('user@acme.com', '123456'), params())
    expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
      'interface-otp:verify:ip:127.0.0.1',
      expect.anything()
    )
  })
})
