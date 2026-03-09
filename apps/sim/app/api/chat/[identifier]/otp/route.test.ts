/**
 * Tests for chat OTP API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRedisSet,
  mockRedisGet,
  mockRedisDel,
  mockGetRedisClient,
  mockRedisClient,
  mockDbSelect,
  mockDbInsert,
  mockDbDelete,
  mockSendEmail,
  mockRenderOTPEmail,
  mockAddCorsHeaders,
  mockCreateSuccessResponse,
  mockCreateErrorResponse,
  mockSetChatAuthCookie,
  mockGenerateRequestId,
  mockGetStorageMethod,
  mockZodParse,
  mockGetEnv,
} = vi.hoisted(() => {
  const mockRedisSet = vi.fn()
  const mockRedisGet = vi.fn()
  const mockRedisDel = vi.fn()
  const mockRedisClient = {
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel,
  }
  const mockGetRedisClient = vi.fn()
  const mockDbSelect = vi.fn()
  const mockDbInsert = vi.fn()
  const mockDbDelete = vi.fn()
  const mockSendEmail = vi.fn()
  const mockRenderOTPEmail = vi.fn()
  const mockAddCorsHeaders = vi.fn()
  const mockCreateSuccessResponse = vi.fn()
  const mockCreateErrorResponse = vi.fn()
  const mockSetChatAuthCookie = vi.fn()
  const mockGenerateRequestId = vi.fn()
  const mockGetStorageMethod = vi.fn()
  const mockZodParse = vi.fn()
  const mockGetEnv = vi.fn()

  return {
    mockRedisSet,
    mockRedisGet,
    mockRedisDel,
    mockGetRedisClient,
    mockRedisClient,
    mockDbSelect,
    mockDbInsert,
    mockDbDelete,
    mockSendEmail,
    mockRenderOTPEmail,
    mockAddCorsHeaders,
    mockCreateSuccessResponse,
    mockCreateErrorResponse,
    mockSetChatAuthCookie,
    mockGenerateRequestId,
    mockGetStorageMethod,
    mockZodParse,
    mockGetEnv,
  }
})

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    delete: mockDbDelete,
    transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => unknown) => {
      return callback({
        select: mockDbSelect,
        insert: mockDbInsert,
        delete: mockDbDelete,
      })
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  chat: {
    id: 'id',
    authType: 'authType',
    allowedEmails: 'allowedEmails',
    title: 'title',
  },
  verification: {
    id: 'id',
    identifier: 'identifier',
    value: 'value',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: string, value: string) => ({ field, value, type: 'eq' })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  gt: vi.fn((field: string, value: string) => ({ field, value, type: 'gt' })),
  lt: vi.fn((field: string, value: string) => ({ field, value, type: 'lt' })),
}))

vi.mock('@/lib/core/storage', () => ({
  getStorageMethod: mockGetStorageMethod,
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: mockSendEmail,
}))

vi.mock('@/components/emails/render-email', () => ({
  renderOTPEmail: mockRenderOTPEmail,
}))

vi.mock('@/app/api/chat/utils', () => ({
  addCorsHeaders: mockAddCorsHeaders,
  setChatAuthCookie: mockSetChatAuthCookie,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  createSuccessResponse: mockCreateSuccessResponse,
  createErrorResponse: mockCreateErrorResponse,
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

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
  const mockStringReturnValue = {
    email: vi.fn().mockReturnThis(),
    length: vi.fn().mockReturnThis(),
  }
  return {
    z: {
      object: vi.fn().mockReturnValue({
        parse: mockZodParse,
      }),
      string: vi.fn().mockReturnValue(mockStringReturnValue),
      ZodError,
    },
  }
})

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: mockGenerateRequestId,
}))

import { POST, PUT } from './route'

describe('Chat OTP API Route', () => {
  const mockEmail = 'test@example.com'
  const mockChatId = 'chat-123'
  const mockIdentifier = 'test-chat'
  const mockOTP = '123456'

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

    const createDbChain = (result: unknown) => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    })

    mockDbSelect.mockImplementation(() => createDbChain([]))
    mockDbInsert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    }))
    mockDbDelete.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }))

    mockGetStorageMethod.mockReturnValue('redis')

    mockSendEmail.mockResolvedValue({ success: true })
    mockRenderOTPEmail.mockResolvedValue('<html>OTP Email</html>')

    mockAddCorsHeaders.mockImplementation((response: unknown) => response)
    mockCreateSuccessResponse.mockImplementation((data: unknown) => ({
      json: () => Promise.resolve(data),
      status: 200,
    }))
    mockCreateErrorResponse.mockImplementation((message: string, status: number) => ({
      json: () => Promise.resolve({ error: message }),
      status,
    }))

    mockGenerateRequestId.mockReturnValue('req-123')

    mockZodParse.mockImplementation((data: unknown) => data)

    mockGetEnv.mockReturnValue('http://localhost:3000')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST - Store OTP (Redis path)', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('redis')
    })

    it('should store OTP in Redis when storage method is redis', async () => {
      mockDbSelect.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: mockChatId,
                authType: 'email',
                allowedEmails: [mockEmail],
                title: 'Test Chat',
              },
            ]),
          }),
        }),
      }))

      const request = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockRedisSet).toHaveBeenCalledWith(
        `otp:${mockEmail}:${mockChatId}`,
        expect.any(String),
        'EX',
        900 // 15 minutes
      )

      expect(mockDbInsert).not.toHaveBeenCalled()
    })
  })

  describe('POST - Store OTP (Database path)', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('database')
      mockGetRedisClient.mockReturnValue(null)
    })

    it('should store OTP in database when storage method is database', async () => {
      mockDbSelect.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: mockChatId,
                authType: 'email',
                allowedEmails: [mockEmail],
                title: 'Test Chat',
              },
            ]),
          }),
        }),
      }))

      const mockInsertValues = vi.fn().mockResolvedValue(undefined)
      mockDbInsert.mockImplementationOnce(() => ({
        values: mockInsertValues,
      }))

      const mockDeleteWhere = vi.fn().mockResolvedValue(undefined)
      mockDbDelete.mockImplementation(() => ({
        where: mockDeleteWhere,
      }))

      const request = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockDbDelete).toHaveBeenCalled()

      expect(mockDbInsert).toHaveBeenCalled()
      expect(mockInsertValues).toHaveBeenCalledWith({
        id: expect.any(String),
        identifier: `chat-otp:${mockChatId}:${mockEmail}`,
        value: expect.any(String),
        expiresAt: expect.any(Date),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })

      expect(mockRedisSet).not.toHaveBeenCalled()
    })
  })

  describe('PUT - Verify OTP (Redis path)', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('redis')
      mockRedisGet.mockResolvedValue(mockOTP)
    })

    it('should retrieve OTP from Redis and verify successfully', async () => {
      mockDbSelect.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: mockChatId,
                authType: 'email',
              },
            ]),
          }),
        }),
      }))

      const request = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockRedisGet).toHaveBeenCalledWith(`otp:${mockEmail}:${mockChatId}`)

      expect(mockRedisDel).toHaveBeenCalledWith(`otp:${mockEmail}:${mockChatId}`)

      expect(mockDbSelect).toHaveBeenCalledTimes(1)
    })
  })

  describe('PUT - Verify OTP (Database path)', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('database')
      mockGetRedisClient.mockReturnValue(null)
    })

    it('should retrieve OTP from database and verify successfully', async () => {
      let selectCallCount = 0

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              selectCallCount++
              if (selectCallCount === 1) {
                return Promise.resolve([
                  {
                    id: mockChatId,
                    authType: 'email',
                  },
                ])
              }
              return Promise.resolve([
                {
                  value: mockOTP,
                  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                },
              ])
            }),
          }),
        }),
      }))

      const mockDeleteWhere = vi.fn().mockResolvedValue(undefined)
      mockDbDelete.mockImplementation(() => ({
        where: mockDeleteWhere,
      }))

      const request = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockDbSelect).toHaveBeenCalledTimes(2)

      expect(mockDbDelete).toHaveBeenCalled()

      expect(mockRedisGet).not.toHaveBeenCalled()
    })

    it('should reject expired OTP from database', async () => {
      let selectCallCount = 0

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              selectCallCount++
              if (selectCallCount === 1) {
                return Promise.resolve([
                  {
                    id: mockChatId,
                    authType: 'email',
                  },
                ])
              }
              return Promise.resolve([])
            }),
          }),
        }),
      }))

      const request = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'No verification code found, request a new one',
        400
      )
    })
  })

  describe('DELETE OTP (Redis path)', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('redis')
    })

    it('should delete OTP from Redis after verification', async () => {
      mockRedisGet.mockResolvedValue(mockOTP)

      mockDbSelect.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: mockChatId,
                authType: 'email',
              },
            ]),
          }),
        }),
      }))

      const request = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockRedisDel).toHaveBeenCalledWith(`otp:${mockEmail}:${mockChatId}`)
      expect(mockDbDelete).not.toHaveBeenCalled()
    })
  })

  describe('DELETE OTP (Database path)', () => {
    beforeEach(() => {
      mockGetStorageMethod.mockReturnValue('database')
      mockGetRedisClient.mockReturnValue(null)
    })

    it('should delete OTP from database after verification', async () => {
      let selectCallCount = 0
      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              selectCallCount++
              if (selectCallCount === 1) {
                return Promise.resolve([{ id: mockChatId, authType: 'email' }])
              }
              return Promise.resolve([
                { value: mockOTP, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
              ])
            }),
          }),
        }),
      }))

      const mockDeleteWhere = vi.fn().mockResolvedValue(undefined)
      mockDbDelete.mockImplementation(() => ({
        where: mockDeleteWhere,
      }))

      const request = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(request, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockDbDelete).toHaveBeenCalled()
      expect(mockRedisDel).not.toHaveBeenCalled()
    })
  })

  describe('Behavior consistency between Redis and Database', () => {
    it('should have same behavior for missing OTP in both storage methods', async () => {
      mockGetStorageMethod.mockReturnValue('redis')
      mockRedisGet.mockResolvedValue(null)

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: mockChatId, authType: 'email' }]),
          }),
        }),
      }))

      const requestRedis = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'PUT',
        body: JSON.stringify({ email: mockEmail, otp: mockOTP }),
      })

      await PUT(requestRedis, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'No verification code found, request a new one',
        400
      )
    })

    it('should have same OTP expiry time in both storage methods', async () => {
      const OTP_EXPIRY = 15 * 60

      mockGetStorageMethod.mockReturnValue('redis')

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: mockChatId,
                authType: 'email',
                allowedEmails: [mockEmail],
                title: 'Test Chat',
              },
            ]),
          }),
        }),
      }))

      const requestRedis = new NextRequest('http://localhost:3000/api/chat/test/otp', {
        method: 'POST',
        body: JSON.stringify({ email: mockEmail }),
      })

      await POST(requestRedis, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        OTP_EXPIRY
      )
    })
  })
})
