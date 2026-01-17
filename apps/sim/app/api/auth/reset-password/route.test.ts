/**
 * Tests for reset password API route
 *
 * @vitest-environment node
 */
import {
  createMockRequest,
  mockConsoleLogger,
  mockCryptoUuid,
  mockDrizzleOrm,
  mockUuid,
  setupCommonApiMocks,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Setup auth API mocks for testing authentication routes */
function setupAuthApiMocks(
  options: {
    operations?: {
      forgetPassword?: { success?: boolean; error?: string }
      resetPassword?: { success?: boolean; error?: string }
    }
  } = {}
) {
  setupCommonApiMocks()
  mockUuid()
  mockCryptoUuid()
  mockConsoleLogger()
  mockDrizzleOrm()

  const { operations = {} } = options
  const defaultOperations = {
    forgetPassword: { success: true, error: 'Forget password error', ...operations.forgetPassword },
    resetPassword: { success: true, error: 'Reset password error', ...operations.resetPassword },
  }

  const createAuthMethod = (config: { success?: boolean; error?: string }) => {
    return vi.fn().mockImplementation(() => {
      if (config.success) {
        return Promise.resolve()
      }
      return Promise.reject(new Error(config.error))
    })
  }

  vi.doMock('@/lib/auth', () => ({
    auth: {
      api: {
        forgetPassword: createAuthMethod(defaultOperations.forgetPassword),
        resetPassword: createAuthMethod(defaultOperations.resetPassword),
      },
    },
  }))
}

describe('Reset Password API Route', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should reset password successfully', async () => {
    setupAuthApiMocks({
      operations: {
        resetPassword: { success: true },
      },
    })

    const req = createMockRequest('POST', {
      token: 'valid-reset-token',
      newPassword: 'newSecurePassword123!',
    })

    const { POST } = await import('@/app/api/auth/reset-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.resetPassword).toHaveBeenCalledWith({
      body: {
        token: 'valid-reset-token',
        newPassword: 'newSecurePassword123!',
      },
      method: 'POST',
    })
  })

  it('should handle missing token', async () => {
    setupAuthApiMocks()

    const req = createMockRequest('POST', {
      newPassword: 'newSecurePassword123',
    })

    const { POST } = await import('@/app/api/auth/reset-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Token is required')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.resetPassword).not.toHaveBeenCalled()
  })

  it('should handle missing new password', async () => {
    setupAuthApiMocks()

    const req = createMockRequest('POST', {
      token: 'valid-reset-token',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Password is required')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.resetPassword).not.toHaveBeenCalled()
  })

  it('should handle empty token', async () => {
    setupAuthApiMocks()

    const req = createMockRequest('POST', {
      token: '',
      newPassword: 'newSecurePassword123',
    })

    const { POST } = await import('@/app/api/auth/reset-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Token is required')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.resetPassword).not.toHaveBeenCalled()
  })

  it('should handle empty new password', async () => {
    setupAuthApiMocks()

    const req = createMockRequest('POST', {
      token: 'valid-reset-token',
      newPassword: '',
    })

    const { POST } = await import('@/app/api/auth/reset-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Password must be at least 8 characters long')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.resetPassword).not.toHaveBeenCalled()
  })

  it('should handle auth service error with message', async () => {
    const errorMessage = 'Invalid or expired token'

    setupAuthApiMocks({
      operations: {
        resetPassword: {
          success: false,
          error: errorMessage,
        },
      },
    })

    const req = createMockRequest('POST', {
      token: 'invalid-token',
      newPassword: 'newSecurePassword123!',
    })

    const { POST } = await import('@/app/api/auth/reset-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe(errorMessage)

    const logger = await import('@sim/logger')
    const mockLogger = logger.createLogger('PasswordResetAPI')
    expect(mockLogger.error).toHaveBeenCalledWith('Error during password reset:', {
      error: expect.any(Error),
    })
  })

  it('should handle unknown error', async () => {
    setupAuthApiMocks()

    vi.doMock('@/lib/auth', () => ({
      auth: {
        api: {
          resetPassword: vi.fn().mockRejectedValue('Unknown error'),
        },
      },
    }))

    const req = createMockRequest('POST', {
      token: 'valid-reset-token',
      newPassword: 'newSecurePassword123!',
    })

    const { POST } = await import('@/app/api/auth/reset-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe(
      'Failed to reset password. Please try again or request a new reset link.'
    )

    const logger = await import('@sim/logger')
    const mockLogger = logger.createLogger('PasswordResetAPI')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
