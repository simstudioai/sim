/**
 * Tests for form API utils
 *
 * @vitest-environment node
 */
import { databaseMock, loggerMock } from '@sim/testing'
import type { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDecryptSecret,
  mockValidateAuthToken,
  mockSetDeploymentAuthCookie,
  mockAddCorsHeaders,
  mockIsEmailAllowed,
} = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
  mockValidateAuthToken: vi.fn().mockReturnValue(false),
  mockSetDeploymentAuthCookie: vi.fn(),
  mockAddCorsHeaders: vi.fn((response: unknown) => response),
  mockIsEmailAllowed: vi.fn(),
}))

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

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

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: vi.fn(),
}))

import { decryptSecret } from '@/lib/core/security/encryption'
import {
  DEFAULT_FORM_CUSTOMIZATIONS,
  setFormAuthCookie,
  validateFormAuth,
} from '@/app/api/form/utils'

describe('Form API Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Auth token utils', () => {
    it('should accept valid auth cookie via validateFormAuth', async () => {
      mockValidateAuthToken.mockReturnValue(true)

      const deployment = {
        id: 'form-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue({ value: 'valid-token' }),
        },
      } as any

      const result = await validateFormAuth('request-id', deployment, mockRequest)
      expect(mockValidateAuthToken).toHaveBeenCalledWith(
        'valid-token',
        'form-id',
        'encrypted-password'
      )
      expect(result.authorized).toBe(true)
    })

    it('should reject invalid auth cookie via validateFormAuth', async () => {
      mockValidateAuthToken.mockReturnValue(false)

      const deployment = {
        id: 'form-id',
        authType: 'password',
        password: 'encrypted-password',
      }

      const mockRequest = {
        method: 'GET',
        cookies: {
          get: vi.fn().mockReturnValue({ value: 'invalid-token' }),
        },
      } as any

      const result = await validateFormAuth('request-id', deployment, mockRequest)
      expect(result.authorized).toBe(false)
    })
  })

  describe('Cookie handling', () => {
    it('should delegate to setDeploymentAuthCookie', () => {
      const mockResponse = {
        cookies: { set: vi.fn() },
      } as unknown as NextResponse

      setFormAuthCookie(mockResponse, 'test-form-id', 'password')

      expect(mockSetDeploymentAuthCookie).toHaveBeenCalledWith(
        mockResponse,
        'form',
        'test-form-id',
        'password',
        undefined
      )
    })
  })

  describe('Form auth validation', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockDecryptSecret.mockResolvedValue({ decrypted: 'correct-password' })
    })

    it('should allow access to public forms', async () => {
      const deployment = {
        id: 'form-id',
        authType: 'public',
      }

      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateFormAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(true)
    })

    it('should request password auth for GET requests', async () => {
      const deployment = {
        id: 'form-id',
        authType: 'password',
      }

      const mockRequest = {
        method: 'GET',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateFormAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(false)
      expect(result.error).toBe('auth_required_password')
    })

    it('should validate password for POST requests', async () => {
      const deployment = {
        id: 'form-id',
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

      const result = await validateFormAuth('request-id', deployment, mockRequest, parsedBody)

      expect(decryptSecret).toHaveBeenCalledWith('encrypted-password')
      expect(result.authorized).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const deployment = {
        id: 'form-id',
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

      const result = await validateFormAuth('request-id', deployment, mockRequest, parsedBody)

      expect(result.authorized).toBe(false)
      expect(result.error).toBe('Invalid password')
    })

    it('should request email auth for email-protected forms', async () => {
      const deployment = {
        id: 'form-id',
        authType: 'email',
        allowedEmails: ['user@example.com', '@company.com'],
      }

      const mockRequest = {
        method: 'GET',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      const result = await validateFormAuth('request-id', deployment, mockRequest)

      expect(result.authorized).toBe(false)
      expect(result.error).toBe('auth_required_email')
    })

    it('should check allowed emails for email auth', async () => {
      const deployment = {
        id: 'form-id',
        authType: 'email',
        allowedEmails: ['user@example.com', '@company.com'],
      }

      const mockRequest = {
        method: 'POST',
        cookies: {
          get: vi.fn().mockReturnValue(null),
        },
      } as any

      // Exact email match should authorize
      mockIsEmailAllowed.mockReturnValue(true)
      const result1 = await validateFormAuth('request-id', deployment, mockRequest, {
        email: 'user@example.com',
      })
      expect(result1.authorized).toBe(true)

      // Domain match should authorize
      const result2 = await validateFormAuth('request-id', deployment, mockRequest, {
        email: 'other@company.com',
      })
      expect(result2.authorized).toBe(true)

      // Unknown email should not authorize
      mockIsEmailAllowed.mockReturnValue(false)
      const result3 = await validateFormAuth('request-id', deployment, mockRequest, {
        email: 'user@unknown.com',
      })
      expect(result3.authorized).toBe(false)
      expect(result3.error).toBe('Email not authorized for this form')
    })

    it('should require password when formData is present without password', async () => {
      const deployment = {
        id: 'form-id',
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
        formData: { field1: 'value1' },
        // No password provided
      }

      const result = await validateFormAuth('request-id', deployment, mockRequest, parsedBody)

      expect(result.authorized).toBe(false)
      expect(result.error).toBe('auth_required_password')
    })
  })

  describe('Default customizations', () => {
    it.concurrent('should have correct default values', () => {
      expect(DEFAULT_FORM_CUSTOMIZATIONS).toEqual({
        welcomeMessage: '',
        thankYouTitle: 'Thank you!',
        thankYouMessage: 'Your response has been submitted successfully.',
      })
    })
  })
})
