/**
 * Tests for forget password API route
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

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn(() => 'https://app.example.com'),
}))

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

describe('Forget Password API Route', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should send password reset email successfully with same-origin redirectTo', async () => {
    setupAuthApiMocks({
      operations: {
        forgetPassword: { success: true },
      },
    })

    const req = createMockRequest('POST', {
      email: 'test@example.com',
      redirectTo: 'https://app.example.com/reset',
    })

    const { POST } = await import('@/app/api/auth/forget-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.forgetPassword).toHaveBeenCalledWith({
      body: {
        email: 'test@example.com',
        redirectTo: 'https://app.example.com/reset',
      },
      method: 'POST',
    })
  })

  it('should reject external redirectTo URL', async () => {
    setupAuthApiMocks({
      operations: {
        forgetPassword: { success: true },
      },
    })

    const req = createMockRequest('POST', {
      email: 'test@example.com',
      redirectTo: 'https://evil.com/phishing',
    })

    const { POST } = await import('@/app/api/auth/forget-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Redirect URL must be a valid same-origin URL')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.forgetPassword).not.toHaveBeenCalled()
  })

  it('should send password reset email without redirectTo', async () => {
    setupAuthApiMocks({
      operations: {
        forgetPassword: { success: true },
      },
    })

    const req = createMockRequest('POST', {
      email: 'test@example.com',
    })

    const { POST } = await import('@/app/api/auth/forget-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.forgetPassword).toHaveBeenCalledWith({
      body: {
        email: 'test@example.com',
        redirectTo: undefined,
      },
      method: 'POST',
    })
  })

  it('should handle missing email', async () => {
    setupAuthApiMocks()

    const req = createMockRequest('POST', {})

    const { POST } = await import('@/app/api/auth/forget-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Email is required')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.forgetPassword).not.toHaveBeenCalled()
  })

  it('should handle empty email', async () => {
    setupAuthApiMocks()

    const req = createMockRequest('POST', {
      email: '',
    })

    const { POST } = await import('@/app/api/auth/forget-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Please provide a valid email address')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.forgetPassword).not.toHaveBeenCalled()
  })

  it('should handle auth service error with message', async () => {
    const errorMessage = 'User not found'

    setupAuthApiMocks({
      operations: {
        forgetPassword: {
          success: false,
          error: errorMessage,
        },
      },
    })

    const req = createMockRequest('POST', {
      email: 'nonexistent@example.com',
    })

    const { POST } = await import('@/app/api/auth/forget-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe(errorMessage)

    const logger = await import('@sim/logger')
    const mockLogger = logger.createLogger('ForgetPasswordTest')
    expect(mockLogger.error).toHaveBeenCalledWith('Error requesting password reset:', {
      error: expect.any(Error),
    })
  })

  it('should handle unknown error', async () => {
    setupAuthApiMocks()

    vi.doMock('@/lib/auth', () => ({
      auth: {
        api: {
          forgetPassword: vi.fn().mockRejectedValue('Unknown error'),
        },
      },
    }))

    const req = createMockRequest('POST', {
      email: 'test@example.com',
    })

    const { POST } = await import('@/app/api/auth/forget-password/route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe('Failed to send password reset email. Please try again later.')

    const logger = await import('@sim/logger')
    const mockLogger = logger.createLogger('ForgetPasswordTest')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
