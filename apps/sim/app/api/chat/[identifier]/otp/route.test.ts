/**
 * Tests for chat OTP API route
 */

import {
  dbChainMockFns,
  envMockFns,
  queueTableRows,
  redisConfigMockFns,
  requestUtilsMockFns,
  resetDbChainMock,
  resetEnvMock,
  schemaMock,
  setEnv,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock, emailTemplatesMockFns } from '@sim/testing/mocks/email-templates.mock'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRedisSet,
  mockRedisGet,
  mockRedisDel,
  mockRedisTtl,
  mockRedisEval,
  mockRedisClient,
  mockSetChatAuthCookie,
  mockIsEmailAllowed,
  mockGetStorageMethod,
  mockZodParse,
  mockAfterResponse,
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
  const mockSetChatAuthCookie = vi.fn()
  const mockIsEmailAllowed = vi.fn((email: string, allowedEmails: string[]) => {
    if (allowedEmails.includes(email)) return true
    const domain = email.slice(email.indexOf('@') + 1)
    return allowedEmails.includes(`@${domain}`)
  })
  const mockGetStorageMethod = vi.fn()
  const mockZodParse = vi.fn()
  const mockAfterResponse = vi.fn()

  return {
    mockRedisSet,
    mockRedisGet,
    mockRedisDel,
    mockRedisTtl,
    mockRedisEval,
    mockRedisClient,
    mockSetChatAuthCookie,
    mockIsEmailAllowed,
    mockGetStorageMethod,
    mockZodParse,
    mockAfterResponse,
  }
})

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient
const mockGetEnv = envMockFns.getEnv
const mockCreateSuccessResponse = workflowsApiUtilsMockFns.mockCreateSuccessResponse
const mockCreateErrorResponse = workflowsApiUtilsMockFns.mockCreateErrorResponse

vi.mock('@/lib/core/storage', () => ({
  getStorageMethod: mockGetStorageMethod,
}))

vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)

vi.mock('@/lib/core/utils/after-response', () => ({
  afterResponse: mockAfterResponse,
}))

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

vi.mock('@/components/emails', () => emailTemplatesMock)

vi.mock('@/lib/core/security/deployment', () => ({
  isEmailAllowed: mockIsEmailAllowed,
}))

vi.mock('@/app/api/chat/utils', () => ({
  setChatAuthCookie: mockSetChatAuthCookie,
}))

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

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

import { PUT, POST as routePost } from './route'

const mockCheckRateLimitDirect = rateLimiterMockFns.mockCheckRateLimitDirect
const { mockSendEmail } = emailMailerMockFns
const { mockRenderOTPEmail } = emailTemplatesMockFns

const POST: typeof routePost = async (...args) => {
  const response = await routePost(...args)
  const task = mockAfterResponse.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined
  if (task) await task()
  return response
}

describe('Chat OTP API Route', () => {
  const mockEmail = 'test@example.com'
  const mockChatId = 'chat-123'
  const mockIdentifier = 'test-chat'
  const mockOTP = '123456'

  /** Queues the chat-deployment row the route reads before touching OTP storage. */
  const queueDeployment = (row: Record<string, unknown>) => {
    queueTableRows(schemaMock.chat, [{ allowedEmails: [mockEmail], ...row }])
  }

  const emailDeployment = {
    id: mockChatId,
    authType: 'email',
    allowedEmails: [mockEmail],
    title: 'Test Chat',
  }

  beforeEach(() => {
    resetDbChainMock()

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

    setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000', NODE_ENV: 'test' })
    mockGetEnv.mockReturnValue('http://localhost:3000')
  })

  afterAll(() => {
    resetDbChainMock()
    resetEnvMock()
  })

  describe('POST - Rate limiting', () => {
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

      const request = createMockRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/chat/test/otp',
        rawBody: JSON.stringify({ email: mockEmail }),
      })

      const response = await POST(request, createRouteContext({ identifier: mockIdentifier }))

      expect(response.status).toBe(429)
      expect(headerSet).toHaveBeenCalledWith('Retry-After', '900')
      expect(mockSendEmail).not.toHaveBeenCalled()
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })

    it('returns the generic acceptance response when the email rate limit is exceeded', async () => {
      mockCheckRateLimitDirect
        .mockResolvedValueOnce({
          allowed: true,
          remaining: 9,
          resetAt: new Date(Date.now() + 60_000),
        })
        .mockResolvedValueOnce({
          allowed: true,
          remaining: 99,
          resetAt: new Date(Date.now() + 60_000),
        })
        .mockResolvedValueOnce({
          allowed: false,
          remaining: 0,
          resetAt: new Date(Date.now() + 900_000),
          retryAfterMs: 900_000,
        })

      queueDeployment(emailDeployment)

      const request = createMockRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/chat/test/otp',
        rawBody: JSON.stringify({ email: mockEmail }),
      })

      const response = await POST(request, createRouteContext({ identifier: mockIdentifier }))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ message: 'Verification code sent' })
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('retains resource and email backstops when the client IP cannot be resolved', async () => {
      requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)
      queueDeployment(emailDeployment)

      const request = createMockRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/chat/test/otp',
        rawBody: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, createRouteContext({ identifier: mockIdentifier }))

      expect(mockAfterResponse).toHaveBeenCalledTimes(1)
      expect(mockCheckRateLimitDirect).toHaveBeenCalledTimes(2)
      expect(mockCheckRateLimitDirect).toHaveBeenNthCalledWith(
        1,
        'chat-otp:resource:chat-123',
        expect.any(Object),
        { failClosed: true }
      )
      expect(mockCheckRateLimitDirect).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('chat-otp:email:'),
        expect.any(Object),
        { failClosed: true }
      )
    })
  })

  describe('PUT - Verify OTP (authType re-check)', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('redis')
      mockRedisGet.mockResolvedValue(`${mockOTP}:0`)
    })

    it('rejects verification when the chat has switched away from email auth', async () => {
      queueDeployment({
        id: mockChatId,
        authType: 'password',
        password: 'encrypted-password',
      })

      const request = createMockRequest({
        method: 'PUT',
        url: 'http://localhost:3000/api/chat/test/otp',
        rawBody: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, createRouteContext({ identifier: mockIdentifier }))

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'This chat does not use email authentication',
        400
      )
      expect(mockRedisGet).not.toHaveBeenCalled()
      expect(mockSetChatAuthCookie).not.toHaveBeenCalled()
    })

    it('rejects verification when the email is no longer allowed', async () => {
      mockIsEmailAllowed.mockReturnValueOnce(false)
      queueDeployment({ id: mockChatId, authType: 'email' })

      const request = createMockRequest({
        method: 'PUT',
        url: 'http://localhost:3000/api/chat/test/otp',
        rawBody: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, createRouteContext({ identifier: mockIdentifier }))

      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Email not authorized', 403)
      expect(mockRedisGet).not.toHaveBeenCalled()
      expect(mockSetChatAuthCookie).not.toHaveBeenCalled()
    })
  })

  describe('PUT - Verify OTP (Database path)', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('database')
      mockGetRedisClient.mockReturnValue(null)
    })

    it('should reject expired OTP from database', async () => {
      queueDeployment({ id: mockChatId, authType: 'email' })
      queueTableRows(schemaMock.verification, [])

      const request = createMockRequest({
        method: 'PUT',
        url: 'http://localhost:3000/api/chat/test/otp',
        rawBody: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, createRouteContext({ identifier: mockIdentifier }))

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'No verification code found, request a new one',
        400
      )
    })
  })

  describe('Brute-force protection', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('redis')
    })

    it('should atomically increment attempts on wrong OTP', async () => {
      mockRedisGet.mockResolvedValue('654321:0')
      mockRedisEval.mockResolvedValue('654321:1')

      queueDeployment({ id: mockChatId, authType: 'email' })

      const request = createMockRequest({
        method: 'PUT',
        url: 'http://localhost:3000/api/chat/test/otp',
        rawBody: JSON.stringify({ email: mockEmail, otp: 'wrong1' }),
      })

      await PUT(request, createRouteContext({ identifier: mockIdentifier }))

      expect(mockRedisEval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        `otp:${mockEmail}:${mockChatId}`,
        5
      )
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Invalid verification code', 400)
    })

    it('should invalidate OTP and return 429 after max failed attempts', async () => {
      mockRedisGet.mockResolvedValue('654321:4')
      mockRedisEval.mockResolvedValue('LOCKED')

      queueDeployment({ id: mockChatId, authType: 'email' })

      const request = createMockRequest({
        method: 'PUT',
        url: 'http://localhost:3000/api/chat/test/otp',
        rawBody: JSON.stringify({ email: mockEmail, otp: 'wrong5' }),
      })

      await PUT(request, createRouteContext({ identifier: mockIdentifier }))

      expect(mockRedisEval).toHaveBeenCalled()
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'Too many failed attempts. Please request a new code.',
        429
      )
    })
  })
})
