/**
 * Tests for chat API utils
 *
 * @vitest-environment node
 */
import {
  encryptionMock,
  encryptionMockFns,
  loggingSessionMock,
  workflowsUtilsMock,
} from '@sim/testing'
import type { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockMergeSubblockStateWithValues,
  mockMergeSubBlockValues,
  mockValidateAuthToken,
  mockSetDeploymentAuthCookie,
  mockAddCorsHeaders,
  mockIsEmailAllowed,
} = vi.hoisted(() => ({
  mockMergeSubblockStateWithValues: vi.fn().mockReturnValue({}),
  mockMergeSubBlockValues: vi.fn().mockReturnValue({}),
  mockValidateAuthToken: vi.fn().mockReturnValue(false),
  mockSetDeploymentAuthCookie: vi.fn(),
  mockAddCorsHeaders: vi.fn((response: unknown) => response),
  mockIsEmailAllowed: vi.fn(),
}))

const mockDecryptSecret = encryptionMockFns.mockDecryptSecret

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

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

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/lib/core/security/deployment', () => ({
  validateAuthToken: mockValidateAuthToken,
  setDeploymentAuthCookie: mockSetDeploymentAuthCookie,
  addCorsHeaders: mockAddCorsHeaders,
  isEmailAllowed: mockIsEmailAllowed,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isDev: true,
  isHosted: false,
  isProd: false,
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

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
    it('should accept valid auth cookie via validateChatAuth', async () => {
      mockValidateAuthToken.mockReturnValue(true)

      const deployment = {
        id: 'chat-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue({ value: 'valid-token' }),
        },
      } as any

      const result = await validateChatAuth('request-id', deployment, mockRequest)
      expect(mockValidateAuthToken).toHaveBeenCalledWith(
        'valid-token',
        'chat-id',
        'encrypted-password'
      )
      expect(result.authorized).toBe(true)
    })

    it('should reject invalid auth cookie via validateChatAuth', async () => {
      mockValidateAuthToken.mockReturnValue(false)

      const deployment = {
        id: 'chat-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = {
        method: 'GET',
        cookies: {
          get: vi.fn().mockReturnValue({ value: 'invalid-token' }),
        },
      } as any

      const result = await validateChatAuth('request-id', deployment, mockRequest)
      expect(result.authorized).toBe(false)
    })
  })

  describe('Cookie handling', () => {
    it('should delegate to setDeploymentAuthCookie', () => {
      const mockResponse = {
        cookies: { set: vi.fn() },
      } as unknown as NextResponse

      setChatAuthCookie(mockResponse, 'test-chat-id', 'password')

      expect(mockSetDeploymentAuthCookie).toHaveBeenCalledWith(
        mockResponse,
        'chat',
        'test-chat-id',
        'password',
        undefined
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

      mockIsEmailAllowed.mockReturnValue(true)
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

      mockIsEmailAllowed.mockReturnValue(false)
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
