/**
 * @vitest-environment node
 */
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
}))
vi.mock('@/components/emails', () => ({ renderOTPEmail: mockRenderOTPEmail }))
vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: mockSendEmail }))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import { POST, PUT } from '@/app/api/files/public/[token]/otp/route'

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
    expect(mockStoreOTP).toHaveBeenCalledWith('file', 'sh_1', 'user@acme.com', '123456')
    expect(mockSendEmail).toHaveBeenCalled()
  })

  it('rejects an email not on the allow-list with 403', async () => {
    mockIsEmailAllowed.mockReturnValueOnce(false)
    const res = await POST(post('user@evil.com'), params())
    expect(res.status).toBe(403)
    expect(mockStoreOTP).not.toHaveBeenCalled()
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
})

describe('PUT /api/files/public/[token]/otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveActiveShareByToken.mockResolvedValue(emailShare)
    mockGetOTP.mockResolvedValue('123456:0')
    mockDecodeOTPValue.mockReturnValue({ otp: '123456', attempts: 0 })
  })

  it('verifies a correct code, sets the cookie, returns authType', async () => {
    const res = await PUT(put('user@acme.com', '123456'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authType: 'email' })
    expect(mockDeleteOTP).toHaveBeenCalledWith('file', 'sh_1', 'user@acme.com')
    expect(mockSetDeploymentAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
      'file',
      'sh_1',
      'email',
      null
    )
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
