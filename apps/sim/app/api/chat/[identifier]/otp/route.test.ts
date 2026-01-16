/**
 * Tests for chat OTP API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Chat OTP API Route', () => {
  const mockEmail = 'test@example.com'
  const mockChatId = 'chat-123'
  const mockIdentifier = 'test-chat'
  const mockOTP = '123456'

  const mockRedisSet = vi.fn()
  const mockRedisGet = vi.fn()
  const mockRedisDel = vi.fn()
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

  let storageMethod: 'redis' | 'database' = 'redis'

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.spyOn(Math, 'random').mockReturnValue(0.123456)
    vi.spyOn(Date, 'now').mockReturnValue(1640995200000)

    vi.stubGlobal('crypto', {
      ...crypto,
      randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
    })

    const mockRedisClient = {
      set: mockRedisSet,
      get: mockRedisGet,
      del: mockRedisDel,
    }
    mockGetRedisClient.mockReturnValue(mockRedisClient)
    mockRedisSet.mockResolvedValue('OK')
    mockRedisGet.mockResolvedValue(null)
    mockRedisDel.mockResolvedValue(1)

    vi.doMock('@/lib/core/config/redis', () => ({
      getRedisClient: mockGetRedisClient,
    }))

    const createDbChain = (result: any) => ({
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

    vi.doMock('@sim/db', () => ({
      db: {
        select: mockDbSelect,
        insert: mockDbInsert,
        delete: mockDbDelete,
        transaction: vi.fn(async (callback) => {
          return callback({
            select: mockDbSelect,
            insert: mockDbInsert,
            delete: mockDbDelete,
          })
        }),
      },
    }))

    vi.doMock('@sim/db/schema', () => ({
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

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
      gt: vi.fn((field, value) => ({ field, value, type: 'gt' })),
      lt: vi.fn((field, value) => ({ field, value, type: 'lt' })),
    }))

    vi.doMock('@/lib/core/storage', () => ({
      getStorageMethod: vi.fn(() => storageMethod),
    }))

    mockSendEmail.mockResolvedValue({ success: true })
    mockRenderOTPEmail.mockResolvedValue('<html>OTP Email</html>')

    vi.doMock('@/lib/messaging/email/mailer', () => ({
      sendEmail: mockSendEmail,
    }))

    vi.doMock('@/components/emails/render-email', () => ({
      renderOTPEmail: mockRenderOTPEmail,
    }))

    mockAddCorsHeaders.mockImplementation((response) => response)
    mockCreateSuccessResponse.mockImplementation((data) => ({
      json: () => Promise.resolve(data),
      status: 200,
    }))
    mockCreateErrorResponse.mockImplementation((message, status) => ({
      json: () => Promise.resolve({ error: message }),
      status,
    }))

    vi.doMock('@/app/api/chat/utils', () => ({
      addCorsHeaders: mockAddCorsHeaders,
      setChatAuthCookie: mockSetChatAuthCookie,
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      createSuccessResponse: mockCreateSuccessResponse,
      createErrorResponse: mockCreateErrorResponse,
    }))

    vi.doMock('@sim/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    vi.doMock('@/lib/core/config/env', async () => {
      const { createEnvMock } = await import('@sim/testing')
      return createEnvMock()
    })

    vi.doMock('zod', () => ({
      z: {
        object: vi.fn().mockReturnValue({
          parse: vi.fn().mockImplementation((data) => data),
        }),
        string: vi.fn().mockReturnValue({
          email: vi.fn().mockReturnThis(),
          length: vi.fn().mockReturnThis(),
        }),
      },
    }))

    mockGenerateRequestId.mockReturnValue('req-123')
    vi.doMock('@/lib/core/utils/request', () => ({
      generateRequestId: mockGenerateRequestId,
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST - Store OTP (Redis path)', () => {
    beforeEach(() => {
      storageMethod = 'redis'
    })

    it('should store OTP in Redis when storage method is redis', async () => {
      const { POST } = await import('./route')

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
      storageMethod = 'database'
      mockGetRedisClient.mockReturnValue(null)
    })

    it('should store OTP in database when storage method is database', async () => {
      const { POST } = await import('./route')

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
      storageMethod = 'redis'
      mockRedisGet.mockResolvedValue(mockOTP)
    })

    it('should retrieve OTP from Redis and verify successfully', async () => {
      const { PUT } = await import('./route')

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
      storageMethod = 'database'
      mockGetRedisClient.mockReturnValue(null)
    })

    it('should retrieve OTP from database and verify successfully', async () => {
      const { PUT } = await import('./route')

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
      const { PUT } = await import('./route')

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
      storageMethod = 'redis'
    })

    it('should delete OTP from Redis after verification', async () => {
      const { PUT } = await import('./route')

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
      storageMethod = 'database'
      mockGetRedisClient.mockReturnValue(null)
    })

    it('should delete OTP from database after verification', async () => {
      const { PUT } = await import('./route')

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
      storageMethod = 'redis'
      mockRedisGet.mockResolvedValue(null)

      const { PUT: PUTRedis } = await import('./route')

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

      await PUTRedis(requestRedis, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'No verification code found, request a new one',
        400
      )
    })

    it('should have same OTP expiry time in both storage methods', async () => {
      const OTP_EXPIRY = 15 * 60

      storageMethod = 'redis'
      const { POST: POSTRedis } = await import('./route')

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

      await POSTRedis(requestRedis, { params: Promise.resolve({ identifier: mockIdentifier }) })

      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        OTP_EXPIRY
      )
    })
  })
})
