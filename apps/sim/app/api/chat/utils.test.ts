/**
 * Tests for chat API utils
 */

import {
  authMockFns,
  createMockRequest,
  encryptionMock,
  encryptionMockFns,
  loggingSessionMock,
  requestUtilsMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockMergeSubblockStateWithValues,
  mockMergeSubBlockValues,
  mockReadDeploymentAuthToken,
  mockSetDeploymentAuthCookie,
  mockIsEmailAllowed,
} = vi.hoisted(() => ({
  mockMergeSubblockStateWithValues: vi.fn().mockReturnValue({}),
  mockMergeSubBlockValues: vi.fn().mockReturnValue({}),
  mockReadDeploymentAuthToken: vi.fn().mockResolvedValue(null),
  mockSetDeploymentAuthCookie: vi.fn(),
  mockIsEmailAllowed: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)

const mockDecryptSecret = encryptionMockFns.mockDecryptSecret

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/executor', () => ({
  Executor: vi.fn(),
}))

vi.mock('@/serializer', () => ({
  Serializer: vi.fn(),
}))

vi.mock('@sim/workflow-persistence/subblocks', () => ({
  mergeSubblockStateWithValues: mockMergeSubblockStateWithValues,
  mergeSubBlockValues: mockMergeSubBlockValues,
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/lib/core/security/deployment', () => ({
  readDeploymentAuthToken: mockReadDeploymentAuthToken,
  setDeploymentAuthCookie: mockSetDeploymentAuthCookie,
  isEmailAllowed: mockIsEmailAllowed,
  deploymentAuthCookieName: (prefix: string, id: string) => `${prefix}_auth_${id}`,
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

import { decryptSecret } from '@/lib/core/security/encryption'
import { validateChatAuth } from '@/app/api/chat/utils'

const mockGetSession = authMockFns.mockGetSession
const mockCheckRateLimitDirect = rateLimiterMockFns.mockCheckRateLimitDirect
mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })

describe('Chat API Utils', () => {
  beforeEach(() => {
    vi.stubGlobal('process', {
      ...process,
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    })
  })

  describe('Auth token utils', () => {
    it('should reject invalid auth cookie via validateChatAuth', async () => {
      mockReadDeploymentAuthToken.mockResolvedValue(null)

      const deployment = {
        id: 'chat-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = createMockRequest('GET', undefined, {
        cookie: 'chat_auth_chat-id=invalid-token',
      })

      const result = await validateChatAuth('request-id', deployment, mockRequest)
      expect(result.authorized).toBe(false)
    })
  })

  describe('Chat auth validation', () => {
    beforeEach(() => {
      mockDecryptSecret.mockResolvedValue({ decrypted: 'correct-password' })
      mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
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

    it('should return 429 when the password IP rate limit is exceeded', async () => {
      mockCheckRateLimitDirect.mockResolvedValueOnce({ allowed: false, retryAfterMs: 60_000 })

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

      const result = await validateChatAuth('request-id', deployment, mockRequest, {
        password: 'any-guess',
      })

      expect(result.authorized).toBe(false)
      expect(result.status).toBe(429)
      expect(result.retryAfterMs).toBe(60_000)
      expect(decryptSecret).not.toHaveBeenCalled()
      expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
        'chat-password:ip:chat-id:127.0.0.1',
        expect.objectContaining({ maxTokens: 10 }),
        { failClosed: true }
      )
    })

    it('should retain the password resource limit when the client IP cannot be resolved', async () => {
      requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)
      const deployment = {
        id: 'chat-id',
        authType: 'password',
        password: 'encrypted-password',
      }
      const mockRequest = createMockRequest('POST')
      const candidate = 'correct-password'

      const result = await validateChatAuth('request-id', deployment, mockRequest, {
        password: candidate,
      })

      expect(result.authorized).toBe(true)
      expect(mockCheckRateLimitDirect).toHaveBeenCalledTimes(1)
      expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
        'chat-password:resource:chat-id',
        expect.objectContaining({ maxTokens: 100 }),
        { failClosed: true }
      )
    })

    it('answers allowed and unlisted emails alike so the allow-list stays private', async () => {
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

      mockIsEmailAllowed.mockImplementation((address: string) => address !== 'user@unknown.com')

      for (const email of ['user@example.com', 'other@company.com', 'user@unknown.com']) {
        expect(await validateChatAuth('request-id', deployment, mockRequest, { email })).toEqual({
          authorized: false,
          error: 'otp_required',
        })
      }
    })

    describe('SSO auth', () => {
      const ssoDeployment = {
        id: 'chat-id',
        authType: 'sso',
        allowedEmails: ['user@example.com', '@company.com'],
      }

      const postRequest = {
        method: 'POST',
        cookies: { get: vi.fn().mockReturnValue(null) },
      } as any

      it('rejects when no session is present', async () => {
        mockGetSession.mockResolvedValue(null)

        const result = await validateChatAuth('request-id', ssoDeployment, postRequest, {
          input: 'hello',
        })

        expect(result.authorized).toBe(false)
        expect(result.error).toBe('auth_required_sso')
      })

      it('ignores body-supplied email and uses the session email', async () => {
        mockGetSession.mockResolvedValue({ user: { email: 'session@example.com' } })
        mockIsEmailAllowed.mockReturnValue(true)

        await validateChatAuth('request-id', ssoDeployment, postRequest, {
          email: 'attacker@evil.com',
          input: 'hello',
        })

        expect(mockIsEmailAllowed).toHaveBeenCalledWith(
          'session@example.com',
          ssoDeployment.allowedEmails
        )
      })

      it('rejects execution when session email is not allowlisted', async () => {
        mockGetSession.mockResolvedValue({ user: { email: 'stranger@other.com' } })
        mockIsEmailAllowed.mockReturnValue(false)

        const result = await validateChatAuth('request-id', ssoDeployment, postRequest, {
          input: 'hello',
        })

        expect(result.authorized).toBe(false)
        expect(result.error).toBe('Your email is not authorized to access this resource')
      })
    })
  })
})
