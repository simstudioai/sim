/**
 * Tests for form OTP API route
 *
 * @vitest-environment node
 */
import {
  redisConfigMock,
  redisConfigMockFns,
  requestUtilsMockFns,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRedisSet,
  mockRedisGet,
  mockRedisDel,
  mockRedisTtl,
  mockRedisEval,
  mockRedisClient,
  mockDbSelect,
  mockDbInsert,
  mockDbDelete,
  mockDbUpdate,
  mockSendEmail,
  mockRenderOTPEmail,
  mockSetFormAuthCookie,
  mockGetStorageMethod,
  mockZodParse,
  mockGetEnv,
} = vi.hoisted(() => {
  const mockRedisSet = vi.fn()
  const mockRedisGet = vi.fn()
  const mockRedisDel = vi.fn()
  const mockRedisTtl = vi.fn()
  const mockRedisEval = vi.fn()
  const mockRedisClient = {
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel,
    ttl: mockRedisTtl,
    eval: mockRedisEval,
  }
  return {
    mockRedisSet,
    mockRedisGet,
    mockRedisDel,
    mockRedisTtl,
    mockRedisEval,
    mockRedisClient,
    mockDbSelect: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbDelete: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockSendEmail: vi.fn(),
    mockRenderOTPEmail: vi.fn(),
    mockSetFormAuthCookie: vi.fn(),
    mockGetStorageMethod: vi.fn(),
    mockZodParse: vi.fn(),
    mockGetEnv: vi.fn(),
  }
})

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient
const mockCreateSuccessResponse = workflowsApiUtilsMockFns.mockCreateSuccessResponse
const mockCreateErrorResponse = workflowsApiUtilsMockFns.mockCreateErrorResponse

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    delete: mockDbDelete,
    update: mockDbUpdate,
    transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => unknown) => {
      return callback({
        select: mockDbSelect,
        insert: mockDbInsert,
        delete: mockDbDelete,
        update: mockDbUpdate,
      })
    }),
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: string, value: string) => ({ field, value, type: 'eq' })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  gt: vi.fn((field: string, value: string) => ({ field, value, type: 'gt' })),
  lt: vi.fn((field: string, value: string) => ({ field, value, type: 'lt' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
}))

vi.mock('@/lib/core/storage', () => ({
  getStorageMethod: mockGetStorageMethod,
}))

const { mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: mockSendEmail,
}))

vi.mock('@/components/emails', () => ({
  renderOTPEmail: mockRenderOTPEmail,
}))

vi.mock('@/lib/core/security/deployment', () => ({
  isEmailAllowed: (email: string, allowedEmails: string[]) => {
    if (allowedEmails.includes(email)) return true
    const atIndex = email.indexOf('@')
    if (atIndex > 0) {
      const domain = email.substring(atIndex + 1)
      if (domain && allowedEmails.some((allowed: string) => allowed === `@${domain}`)) return true
    }
    return false
  },
}))

vi.mock('@/app/api/form/utils', () => ({
  setFormAuthCookie: mockSetFormAuthCookie,
}))

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/core/config/env', () => ({
  env: {
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  getEnv: mockGetEnv,
  isTruthy: vi.fn().mockReturnValue(false),
  isFalsy: vi.fn().mockReturnValue(true),
}))

vi.mock('zod', () => {
  class ZodError extends Error {
    errors: Array<{ message: string }>
    constructor(issues: Array<{ message: string }>) {
      super('ZodError')
      this.errors = issues
    }
  }
  const chainable: Record<string, unknown> = {}
  const proxy: Record<string, unknown> = new Proxy(chainable, {
    get(target, prop) {
      if (prop === 'parse') return mockZodParse
      if (prop === 'safeParse') {
        return (data: unknown) => ({ success: true, data })
      }
      if (prop === 'then') return undefined
      if (typeof prop === 'symbol') return Reflect.get(target, prop)
      if (!(prop in target)) {
        target[prop as string] = vi.fn().mockReturnValue(proxy)
      }
      return target[prop as string]
    },
  })
  const makeChain = vi.fn(() => proxy)
  return {
    z: new Proxy(
      { ZodError },
      {
        get(target, prop) {
          if (prop === 'ZodError') return ZodError
          if (typeof prop === 'symbol') return Reflect.get(target, prop)
          return makeChain
        },
      }
    ),
  }
})

import { POST, PUT } from './route'

describe('Form OTP API Route', () => {
  const mockEmail = 'user@example.com'
  const mockFormId = 'form-123'
  const mockIdentifier = 'test-form'
  const mockOTP = '123456'

  const deploymentRow = {
    id: mockFormId,
    authType: 'email',
    allowedEmails: [mockEmail],
    title: 'Test Form',
    isActive: true,
  }

  const verifyDeploymentRow = {
    id: mockFormId,
    authType: 'email',
    password: null,
    allowedEmails: [mockEmail],
    isActive: true,
  }

  const selectOnce = (rows: unknown[]) =>
    mockDbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }))

  beforeEach(() => {
    vi.clearAllMocks()

    vi.spyOn(Math, 'random').mockReturnValue(0.123456)
    vi.spyOn(Date, 'now').mockReturnValue(1640995200000)

    vi.stubGlobal('crypto', {
      ...crypto,
      randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
    })

    mockGetRedisClient.mockReturnValue(mockRedisClient)
    mockRedisSet.mockResolvedValue('OK')
    mockRedisGet.mockResolvedValue(null)
    mockRedisDel.mockResolvedValue(1)
    mockRedisTtl.mockResolvedValue(600)

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }))
    mockDbInsert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }))
    mockDbDelete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
    mockDbUpdate.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }))

    mockGetStorageMethod.mockReturnValue('redis')

    mockSendEmail.mockResolvedValue({ success: true })
    mockRenderOTPEmail.mockResolvedValue('<html>OTP Email</html>')

    mockCreateSuccessResponse.mockImplementation((data: unknown) => ({
      json: () => Promise.resolve(data),
      status: 200,
    }))
    mockCreateErrorResponse.mockImplementation((message: string, status: number) => ({
      json: () => Promise.resolve({ error: message }),
      status,
    }))

    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('req-123')
    requestUtilsMockFns.mockGetClientIp.mockReturnValue('1.2.3.4')

    mockCheckRateLimitDirect.mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: new Date(Date.now() + 60_000),
    })

    mockZodParse.mockImplementation((data: unknown) => data)
    mockGetEnv.mockReturnValue('http://localhost:3000')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST /otp - request code', () => {
    it('stores OTP in Redis when storage is redis and sends email', async () => {
      selectOnce([deploymentRow])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockRedisSet).toHaveBeenCalledWith(
        `form-otp:${mockEmail}:${mockFormId}`,
        expect.stringMatching(/^\d{6}:0$/),
        'EX',
        900
      )
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: mockEmail, subject: expect.stringContaining('Test Form') })
      )
      expect(mockDbInsert).not.toHaveBeenCalled()
    })

    it('stores OTP in database when storage is database', async () => {
      mockGetStorageMethod.mockReturnValue('database')
      mockGetRedisClient.mockReturnValue(null)
      selectOnce([deploymentRow])
      const insertValues = vi.fn().mockResolvedValue(undefined)
      mockDbInsert.mockImplementationOnce(() => ({ values: insertValues }))

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: `form-otp:${mockFormId}:${mockEmail}`,
          value: expect.stringMatching(/^\d{6}:0$/),
        })
      )
      expect(mockRedisSet).not.toHaveBeenCalled()
    })

    it('returns 404 when form is not found', async () => {
      selectOnce([])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Form not found', 404)
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('returns 403 when form is inactive', async () => {
      selectOnce([{ ...deploymentRow, isActive: false }])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'This form is currently unavailable',
        403
      )
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('returns 400 when form authType is not email', async () => {
      selectOnce([{ ...deploymentRow, authType: 'public' }])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'This form does not use email authentication',
        400
      )
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('returns 403 when email is not in allowedEmails', async () => {
      selectOnce([{ ...deploymentRow, allowedEmails: ['other@example.com'] }])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Email not authorized for this form',
        403
      )
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('authorizes by domain match in allowedEmails', async () => {
      selectOnce([{ ...deploymentRow, allowedEmails: ['@example.com'] }])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockSendEmail).toHaveBeenCalled()
    })

    it('returns 429 with Retry-After when IP rate limit is exceeded', async () => {
      mockCheckRateLimitDirect.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 900_000),
        retryAfterMs: 900_000,
      })
      const headerSet = vi.fn()
      mockCreateErrorResponse.mockImplementationOnce((message: string, status: number) => ({
        json: () => Promise.resolve({ error: message }),
        status,
        headers: { set: headerSet },
      }))

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      const response = await POST(request, {
        params: Promise.resolve({ identifier: mockIdentifier }),
      })

      expect(response.status).toBe(429)
      expect(headerSet).toHaveBeenCalledWith('Retry-After', '900')
      expect(mockSendEmail).not.toHaveBeenCalled()
      expect(mockDbSelect).not.toHaveBeenCalled()
    })

    it('returns 429 with Retry-After when email rate limit is exceeded', async () => {
      mockCheckRateLimitDirect
        .mockResolvedValueOnce({
          allowed: true,
          remaining: 9,
          resetAt: new Date(Date.now() + 60_000),
        })
        .mockResolvedValueOnce({
          allowed: false,
          remaining: 0,
          resetAt: new Date(Date.now() + 900_000),
          retryAfterMs: 900_000,
        })
      const headerSet = vi.fn()
      mockCreateErrorResponse.mockImplementationOnce((message: string, status: number) => ({
        json: () => Promise.resolve({ error: message }),
        status,
        headers: { set: headerSet },
      }))
      selectOnce([deploymentRow])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      const response = await POST(request, {
        params: Promise.resolve({ identifier: mockIdentifier }),
      })

      expect(response.status).toBe(429)
      expect(headerSet).toHaveBeenCalledWith('Retry-After', '900')
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('rate-limits the IP bucket before reading the deployment row', async () => {
      mockCheckRateLimitDirect.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 900_000),
        retryAfterMs: 900_000,
      })
      mockCreateErrorResponse.mockImplementationOnce((message: string, status: number) => ({
        json: () => Promise.resolve({ error: message }),
        status,
        headers: { set: vi.fn() },
      }))

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockDbSelect).not.toHaveBeenCalled()
    })

    it('returns 500 when email send fails', async () => {
      selectOnce([deploymentRow])
      mockSendEmail.mockResolvedValueOnce({ success: false, message: 'smtp down' })

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Failed to send verification email', 500)
    })
  })

  describe('PUT /otp - verify code', () => {
    it('verifies OTP, deletes it, and sets the form auth cookie on success', async () => {
      selectOnce([verifyDeploymentRow])
      mockRedisGet.mockResolvedValue(`${mockOTP}:0`)

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockRedisGet).toHaveBeenCalledWith(`form-otp:${mockEmail}:${mockFormId}`)
      expect(mockRedisDel).toHaveBeenCalledWith(`form-otp:${mockEmail}:${mockFormId}`)
      expect(mockSetFormAuthCookie).toHaveBeenCalledWith(
        expect.any(Object),
        mockFormId,
        'email',
        null
      )
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({ authenticated: true })
    })

    it('returns 404 when form is not found', async () => {
      selectOnce([])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Form not found', 404)
      expect(mockSetFormAuthCookie).not.toHaveBeenCalled()
    })

    it('returns 403 when form is inactive at verify time', async () => {
      selectOnce([{ ...verifyDeploymentRow, isActive: false }])

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'This form is currently unavailable',
        403
      )
      expect(mockSetFormAuthCookie).not.toHaveBeenCalled()
    })

    it('returns 403 when email is no longer in allowedEmails at verify time', async () => {
      selectOnce([{ ...verifyDeploymentRow, allowedEmails: ['other@example.com'] }])
      mockRedisGet.mockResolvedValue(`${mockOTP}:0`)

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Email not authorized for this form',
        403
      )
      expect(mockSetFormAuthCookie).not.toHaveBeenCalled()
    })

    it('returns 400 when no OTP is stored', async () => {
      selectOnce([verifyDeploymentRow])
      mockRedisGet.mockResolvedValue(null)

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'No verification code found, request a new one',
        400
      )
      expect(mockSetFormAuthCookie).not.toHaveBeenCalled()
    })

    it('atomically increments attempts on wrong OTP and returns 400', async () => {
      selectOnce([verifyDeploymentRow])
      mockRedisGet.mockResolvedValue('654321:0')
      mockRedisEval.mockResolvedValue('654321:1')

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: 'wrong1' }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockRedisEval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        `form-otp:${mockEmail}:${mockFormId}`,
        5
      )
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Invalid verification code', 400)
      expect(mockSetFormAuthCookie).not.toHaveBeenCalled()
    })

    it('invalidates OTP and returns 429 after max failed attempts', async () => {
      selectOnce([verifyDeploymentRow])
      mockRedisGet.mockResolvedValue('654321:4')
      mockRedisEval.mockResolvedValue('LOCKED')

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: 'wrong5' }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Too many failed attempts. Please request a new code.',
        429
      )
      expect(mockSetFormAuthCookie).not.toHaveBeenCalled()
    })

    it('rejects when stored OTP is already at max attempts', async () => {
      selectOnce([verifyDeploymentRow])
      mockRedisGet.mockResolvedValue(`${mockOTP}:5`)
      const deleteWhere = vi.fn().mockResolvedValue(undefined)
      mockDbDelete.mockImplementation(() => ({ where: deleteWhere }))

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Too many failed attempts. Please request a new code.',
        429
      )
      expect(mockSetFormAuthCookie).not.toHaveBeenCalled()
    })

    it('uses database storage path when configured', async () => {
      mockGetStorageMethod.mockReturnValue('database')
      mockGetRedisClient.mockReturnValue(null)
      let selectCallCount = 0
      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              selectCallCount++
              if (selectCallCount === 1) return Promise.resolve([verifyDeploymentRow])
              return Promise.resolve([
                {
                  value: `${mockOTP}:0`,
                  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                },
              ])
            }),
          }),
        }),
      }))
      const deleteWhere = vi.fn().mockResolvedValue(undefined)
      mockDbDelete.mockImplementation(() => ({ where: deleteWhere }))

      const request = new NextRequest('http://localhost:3000/api/form/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockDbDelete).toHaveBeenCalled()
      expect(mockRedisDel).not.toHaveBeenCalled()
      expect(mockSetFormAuthCookie).toHaveBeenCalled()
    })
  })
})
