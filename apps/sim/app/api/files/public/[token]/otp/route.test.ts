/**
 * @vitest-environment node
 */
import { requestUtilsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveActiveShareByToken,
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
  mockAfterResponse,
} = vi.hoisted(() => ({
  mockResolveActiveShareByToken: vi.fn(),
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
  mockAfterResponse: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mockResolveActiveShareByToken,
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
  OTP_RESOURCE_RATE_LIMIT: { maxTokens: 100, refillRate: 100, refillIntervalMs: 1000 },
}))
vi.mock('@/components/emails', () => ({
  getOtpSubject: (label: string) => `Verification code for ${label}`,
  renderOTPEmail: mockRenderOTPEmail,
}))
vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: mockSendEmail }))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))
vi.mock('@/lib/core/utils/after-response', () => ({
  afterResponse: mockAfterResponse,
}))

import { PUT, POST as routePost } from '@/app/api/files/public/[token]/otp/route'

const POST: typeof routePost = async (...args) => {
  const response = await routePost(...args)
  const task = mockAfterResponse.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined
  if (task) await task()
  return response
}

const params = (token = 'tok_1') => ({ params: Promise.resolve({ token }) })
const post = (email: string, token = 'tok_1') =>
  new NextRequest(`http://localhost/api/files/public/${token}/otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
const put = (email: string, otp: string, token = 'tok_1') =>
  new NextRequest(`http://localhost/api/files/public/${token}/otp`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  })

const emailShare = {
  share: { id: 'sh_1', authType: 'email', password: null, allowedEmails: ['@acme.com'] },
  file: { originalName: 'report.pdf' },
}

describe('POST /api/files/public/[token]/otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
    mockResolveActiveShareByToken.mockResolvedValue(emailShare)
    mockIsEmailAllowed.mockReturnValue(true)
    mockGenerateOTP.mockReturnValue('123456')
    mockRenderOTPEmail.mockResolvedValue('<html/>')
    mockSendEmail.mockResolvedValue({ success: true })
  })

  it('sends a code to an allow-listed email', async () => {
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(200)
    expect(mockAfterResponse).toHaveBeenCalledTimes(1)
    expect(mockStoreOTP).toHaveBeenCalledWith('file', 'sh_1', 'user@acme.com', '123456')
    expect(mockSendEmail).toHaveBeenCalled()
  })

  it('returns the generic acceptance response for an email not on the allow-list', async () => {
    mockIsEmailAllowed.mockReturnValueOnce(false)
    const res = await POST(post('user@evil.com'), params())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: 'Verification code sent' })
    expect(mockCheckRateLimitDirect).toHaveBeenCalledTimes(1)
    expect(mockStoreOTP).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does not consume a send bucket for a rejected email without a client IP', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)
    mockIsEmailAllowed.mockReturnValueOnce(false)

    const res = await POST(post('user@evil.com'), params())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: 'Verification code sent' })
    expect(mockAfterResponse).toHaveBeenCalledTimes(1)
    expect(mockCheckRateLimitDirect).not.toHaveBeenCalled()
    expect(mockStoreOTP).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('lowercases the email for allow-list matching and OTP storage', async () => {
    await POST(post('User@ACME.com'), params())
    expect(mockIsEmailAllowed).toHaveBeenCalledWith('user@acme.com', expect.anything())
    expect(mockStoreOTP).toHaveBeenCalledWith('file', 'sh_1', 'user@acme.com', '123456')
  })

  it('rejects a non-email share with 400', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce({
      ...emailShare,
      share: { ...emailShare.share, authType: 'password' },
    })
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(400)
  })

  it('returns 429 when the IP rate limit is exceeded', async () => {
    mockCheckRateLimitDirect.mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 })
    const res = await POST(post('user@acme.com'), params())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1')
  })

  it('returns the generic acceptance response when the share resource limit is exceeded', async () => {
    mockCheckRateLimitDirect
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 })

    const res = await POST(post('user@acme.com'), params())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: 'Verification code sent' })
    expect(mockStoreOTP).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns the generic acceptance response when the email rate limit is exceeded', async () => {
    mockCheckRateLimitDirect
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 })

    const res = await POST(post('user@acme.com'), params())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: 'Verification code sent' })
    expect(mockStoreOTP).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns the generic acceptance response when email delivery fails', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, message: 'Delivery failed' })

    const res = await POST(post('user@acme.com'), params())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: 'Verification code sent' })
  })

  it('retains resource and email backstops when the client IP cannot be resolved', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)

    const res = await POST(post('user@acme.com'), params())

    expect(res.status).toBe(200)
    expect(mockCheckRateLimitDirect).toHaveBeenCalledTimes(2)
    expect(mockCheckRateLimitDirect).toHaveBeenNthCalledWith(
      1,
      'file-otp:resource:sh_1',
      expect.any(Object),
      { failClosed: true }
    )
    expect(mockCheckRateLimitDirect).toHaveBeenNthCalledWith(
      2,
      'file-otp:email:sh_1:user@acme.com',
      expect.any(Object),
      { failClosed: true }
    )
  })
})

describe('PUT /api/files/public/[token]/otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveActiveShareByToken.mockResolvedValue(emailShare)
    mockIsEmailAllowed.mockReturnValue(true)
    mockGetOTP.mockResolvedValue('123456:0')
    mockDecodeOTPValue.mockReturnValue({ otp: '123456', attempts: 0 })
  })

  it('verifies a correct code, sets the cookie, returns authType', async () => {
    const res = await PUT(put('user@acme.com', '123456'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authType: 'email' })
    expect(mockDeleteOTP).toHaveBeenCalledWith('file', 'sh_1', 'user@acme.com')
    expect(mockSetDeploymentAuthCookie).toHaveBeenCalledWith({
      response: expect.anything(),
      cookiePrefix: 'file',
      resource: emailShare.share,
      verifiedEmail: 'user@acme.com',
    })
  })

  it('rejects a valid code when the email is no longer allowed', async () => {
    mockIsEmailAllowed.mockReturnValueOnce(false)

    const res = await PUT(put('user@acme.com', '123456'), params())

    expect(res.status).toBe(403)
    expect(mockGetOTP).not.toHaveBeenCalled()
    expect(mockDeleteOTP).not.toHaveBeenCalled()
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('rejects a wrong code with 400 and increments attempts', async () => {
    mockIncrementOTPAttempts.mockResolvedValueOnce('incremented')
    const res = await PUT(put('user@acme.com', '000000'), params())
    expect(res.status).toBe(400)
    expect(mockIncrementOTPAttempts).toHaveBeenCalled()
    expect(mockSetDeploymentAuthCookie).not.toHaveBeenCalled()
  })

  it('returns 429 when attempts are exhausted on a wrong code', async () => {
    mockIncrementOTPAttempts.mockResolvedValueOnce('locked')
    const res = await PUT(put('user@acme.com', '000000'), params())
    expect(res.status).toBe(429)
  })

  it('returns 400 when no code was issued', async () => {
    mockGetOTP.mockResolvedValueOnce(null)
    const res = await PUT(put('user@acme.com', '123456'), params())
    expect(res.status).toBe(400)
  })
})
