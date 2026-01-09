import { databaseMock, loggerMock } from '@sim/testing'
import type { NextResponse } from 'next/server'
/**
 * Tests for form API utils
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/logger', () => loggerMock)

const mockDecryptSecret = vi.fn()

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isDev: true,
  isHosted: false,
  isProd: false,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasAdminPermission: vi.fn(),
}))

describe('Form API Utils', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Auth token utils', () => {
    it.concurrent('should validate auth tokens', async () => {
      const { validateAuthToken } = await import('@/lib/core/security/deployment')

      const formId = 'test-form-id'
      const type = 'password'

      const token = Buffer.from(`${formId}:${type}:${Date.now()}`).toString('base64')
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)

      const isValid = validateAuthToken(token, formId)
      expect(isValid).toBe(true)

      const isInvalidForm = validateAuthToken(token, 'wrong-form-id')
      expect(isInvalidForm).toBe(false)
    })

    it.concurrent('should reject expired tokens', async () => {
      const { validateAuthToken } = await import('@/lib/core/security/deployment')

      const formId = 'test-form-id'
      const expiredToken = Buffer.from(
        `${formId}:password:${Date.now() - 25 * 60 * 60 * 1000}`
      ).toString('base64')

      const isValid = validateAuthToken(expiredToken, formId)
      expect(isValid).toBe(false)
    })

    it.concurrent('should validate tokens with password hash', async () => {
      const { validateAuthToken } = await import('@/lib/core/security/deployment')
      const crypto = await import('crypto')

      const formId = 'test-form-id'
      const encryptedPassword = 'encrypted-password-value'
      const pwHash = crypto
        .createHash('sha256')
        .update(encryptedPassword)
        .digest('hex')
        .substring(0, 8)

      const token = Buffer.from(`${formId}:password:${Date.now()}:${pwHash}`).toString('base64')

      const isValid = validateAuthToken(token, formId, encryptedPassword)
      expect(isValid).toBe(true)

      const isInvalidPassword = validateAuthToken(token, formId, 'different-password')
      expect(isInvalidPassword).toBe(false)
    })
  })

  describe('Cookie handling', () => {
    it('should set auth cookie correctly', async () => {
      const { setFormAuthCookie } = await import('@/app/api/form/utils')

      const mockSet = vi.fn()
      const mockResponse = {
        cookies: {
          set: mockSet,
        },
      } as unknown as NextResponse

      const formId = 'test-form-id'
      const type = 'password'

      setFormAuthCookie(mockResponse, formId, type)

      expect(mockSet).toHaveBeenCalledWith({
        name: `form_auth_${formId}`,
        value: expect.any(String),
        httpOnly: true,
        secure: false, // Development mode
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24,
      })
    })
  })

  describe('CORS handling', () => {
    it.concurrent('should add CORS headers for any origin', async () => {
      const { addCorsHeaders } = await import('@/lib/core/security/deployment')

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

    it.concurrent('should not set CORS headers when no origin', async () => {
      const { addCorsHeaders } = await import('@/lib/core/security/deployment')

      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue(''),
        },
      } as any

      const mockResponse = {
        headers: {
          set: vi.fn(),
        },
      } as unknown as NextResponse

      addCorsHeaders(mockResponse, mockRequest)

      expect(mockResponse.headers.set).not.toHaveBeenCalled()
    })
  })

  describe('Form auth validation', () => {
    beforeEach(async () => {
      vi.clearAllMocks()
      mockDecryptSecret.mockResolvedValue({ decrypted: 'correct-password' })
    })

    it('should allow access to public forms', async () => {
      const { validateFormAuth } = await import('@/app/api/form/utils')

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
      const { validateFormAuth } = await import('@/app/api/form/utils')

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
      const { validateFormAuth } = await import('@/app/api/form/utils')
      const { decryptSecret } = await import('@/lib/core/security/encryption')

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
      const { validateFormAuth } = await import('@/app/api/form/utils')

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
      const { validateFormAuth } = await import('@/app/api/form/utils')

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
      const { validateFormAuth } = await import('@/app/api/form/utils')

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
      const result3 = await validateFormAuth('request-id', deployment, mockRequest, {
        email: 'user@unknown.com',
      })
      expect(result3.authorized).toBe(false)
      expect(result3.error).toBe('Email not authorized for this form')
    })

    it('should require password when formData is present without password', async () => {
      const { validateFormAuth } = await import('@/app/api/form/utils')

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
    it.concurrent('should have correct default values', async () => {
      const { DEFAULT_FORM_CUSTOMIZATIONS } = await import('@/app/api/form/utils')

      expect(DEFAULT_FORM_CUSTOMIZATIONS).toEqual({
        welcomeMessage: '',
        thankYouTitle: 'Thank you!',
        thankYouMessage: 'Your response has been submitted successfully.',
      })
    })
  })
})
