/**
 * Tests for chat API utils
 *
 * @vitest-environment node
 */
import { databaseMock, loggerMock, requestUtilsMock } from '@sim/testing'
import type { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret, mockMergeSubblockStateWithValues, mockMergeSubBlockValues } = vi.hoisted(
  () => ({
    mockDecryptSecret: vi.fn(),
    mockMergeSubblockStateWithValues: vi.fn().mockReturnValue({}),
    mockMergeSubBlockValues: vi.fn().mockReturnValue({}),
  })
)

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(() => ({
    safeStart: vi.fn().mockResolvedValue(undefined),
    safeComplete: vi.fn().mockResolvedValue(undefined),
    safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@/executor', () => ({
  Executor: vi.fn(),
}))

vi.mock('@/serializer', () => ({
  Serializer: vi.fn(),
}))

vi.mock('@/lib/workflows/subblocks', () => ({
  mergeSubblockStateWithValues: mockMergeSubblockStateWithValues,
  mergeSubBlockValues: mockMergeSubBlockValues,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/core/utils/request', () => requestUtilsMock)

vi.mock('@/lib/core/config/feature-flags', () => ({
  isDev: true,
  isHosted: false,
  isProd: false,
}))

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: vi.fn(),
}))

import { addCorsHeaders, validateAuthToken } from '@/lib/core/security/deployment'
import { decryptSecret } from '@/lib/core/security/encryption'
import { setChatAuthCookie, validateChatAuth } from '@/app/api/chat/utils'

describe('Chat API Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('process', {
      ...process,
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    })
  })

  describe('Auth token utils', () => {
    it.concurrent('should validate auth tokens', () => {
      const chatId = 'test-chat-id'
      const type = 'password'

      const token = Buffer.from(`${chatId}:${type}:${Date.now()}`).toString('base64')
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)

      const isValid = validateAuthToken(token, chatId)
      expect(isValid).toBe(true)

      const isInvalidChat = validateAuthToken(token, 'wrong-chat-id')
      expect(isInvalidChat).toBe(false)
    })

    it.concurrent('should reject expired tokens', () => {
      const chatId = 'test-chat-id'
      const expiredToken = Buffer.from(
        `${chatId}:password:${Date.now() - 25 * 60 * 60 * 1000}`
      ).toString('base64')

      const isValid = validateAuthToken(expiredToken, chatId)
      expect(isValid).toBe(false)
    })
  })

  describe('Cookie handling', () => {
    it('should set auth cookie correctly', () => {
      const mockSet = vi.fn()
      const mockResponse = {
        cookies: {
          set: mockSet,
        },
      } as unknown as NextResponse

      const chatId = 'test-chat-id'
      const type = 'password'

      setChatAuthCookie(mockResponse, chatId, type)

      expect(mockSet).toHaveBeenCalledWith({
        name: `chat_auth_${chatId}`,
        value: expect.any(String),
        httpOnly: true,
        secure: false, // Development mode
        sameSite: 'lax',
        path: '/',
        domain: undefined, // Development mode
        maxAge: 60 * 60 * 24,
      })
    })
  })

  describe('CORS handling', () => {
    it('should add CORS headers for localhost in development', () => {
      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue('http://localhost:3000'),
        },
      } as any

      const mockResponse = {
        headers: {
          set: vi.fn(),
        },
      } as unknown as NextResponse

      addCorsHeaders(mockResponse, mockRequest)

      expect(mockResponse.headers.set).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://localhost:3000'
      )
      expect(mockResponse.headers.set).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true'
      )
      expect(mockResponse.headers.set).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
      )
      expect(mockResponse.headers.set).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Requested-With'
      )
    })
  })

  describe('Chat auth validation', () => {
    beforeEach(() => {
      mockDecryptSecret.mockResolvedValue({ decrypted: 'correct-password' })
    })

    it('should allow access to public chats', async () => {
      const deployment = {
        id: 'chat-id',
        authType: 'public',
      }

      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateChatAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(true)
    })

    it('should request password auth for GET requests', async () => {
      const deployment = {
        id: 'chat-id',
        authType: 'password',
      }

      const mockRequest = {
        method: 'GET',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateChatAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(false)
      expect(result.error).toBe('auth_required_password')
    })

    it('should validate password for POST requests', async () => {
      const deployment = {
        id: 'chat-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const parsedBody = {
        password: 'correct-password',
      }

      const result = await validateChatAuth('request-id', deployment, mockRequest, parsedBody)

      expect(decryptSecret).toHaveBeenCalledWith('encrypted-password')
      expect(result.authorized).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const deployment = {
        id: 'chat-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const parsedBody = {
        password: 'wrong-password',
      }

      const result = await validateChatAuth('request-id', deployment, mockRequest, parsedBody)

      expect(result.authorized).toBe(false)
      expect(result.error).toBe('Invalid password')
    })

    it('should request email auth for email-protected chats', async () => {
      const deployment = {
        id: 'chat-id',
        authType: 'email',
        allowedEmails: ['user@example.com', '@company.com'],
      }

      const mockRequest = {
        method: 'GET',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateChatAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(false)
      expect(result.error).toBe('auth_required_email')
    })

    it('should check allowed emails for email auth', async () => {
      const deployment = {
        id: 'chat-id',
        authType: 'email',
        allowedEmails: ['user@example.com', '@company.com'],
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result1 = await validateChatAuth('request-id', deployment, mockRequest, {
        email: 'user@example.com',
      })
      expect(result1.authorized).toBe(false)
      expect(result1.error).toBe('otp_required')

      const result2 = await validateChatAuth('request-id', deployment, mockRequest, {
        email: 'other@company.com',
      })
      expect(result2.authorized).toBe(false)
      expect(result2.error).toBe('otp_required')

      const result3 = await validateChatAuth('request-id', deployment, mockRequest, {
        email: 'user@unknown.com',
      })
      expect(result3.authorized).toBe(false)
      expect(result3.error).toBe('Email not authorized')
    })
  })

  describe('Execution Result Processing', () => {
    it.concurrent('should process logs regardless of overall success status', () => {
      const executionResult = {
        success: false,
        output: {},
        logs: [
          {
            blockId: 'agent1',
            startedAt: '2023-01-01T00:00:00Z',
            endedAt: '2023-01-01T00:00:01Z',
            durationMs: 1000,
            success: true,
            output: { content: 'Agent 1 succeeded' },
            error: undefined,
          },
          {
            blockId: 'agent2',
            startedAt: '2023-01-01T00:00:00Z',
            endedAt: '2023-01-01T00:00:01Z',
            durationMs: 500,
            success: false,
            output: null,
            error: 'Agent 2 failed',
          },
        ],
        metadata: { duration: 1000 },
      }

      expect(executionResult.success).toBe(false)
      expect(executionResult.logs).toBeDefined()
      expect(executionResult.logs).toHaveLength(2)

      expect(executionResult.logs[0].success).toBe(true)
      expect(executionResult.logs[0].output?.content).toBe('Agent 1 succeeded')

      expect(executionResult.logs[1].success).toBe(false)
      expect(executionResult.logs[1].error).toBe('Agent 2 failed')
    })

    it.concurrent('should handle ExecutionResult vs StreamingExecution types correctly', () => {
      const executionResult = {
        success: true,
        output: { content: 'test' },
        logs: [],
        metadata: { duration: 100 },
      }

      const directResult = executionResult
      const extractedDirect = directResult
      expect(extractedDirect).toBe(executionResult)

      const streamingResult = {
        stream: new ReadableStream(),
        execution: executionResult,
      }

      const extractedFromStreaming =
        streamingResult && typeof streamingResult === 'object' && 'execution' in streamingResult
          ? streamingResult.execution
          : streamingResult

      expect(extractedFromStreaming).toBe(executionResult)
    })
  })
})
