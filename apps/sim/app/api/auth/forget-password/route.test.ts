/**
 * Tests for forget password API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuthApi, setupApiTestMocks } from '@/app/api/__test-utils__/utils'

describe('Forget Password API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    setupApiTestMocks()
    mockAuthApi()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should send password reset email successfully', async () => {
    const req = createMockRequest('POST', {
      email: 'test@example.com',
      redirectTo: 'https://example.com/reset',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.forgetPassword).toHaveBeenCalledWith({
      body: {
        email: 'test@example.com',
        redirectTo: 'https://example.com/reset',
      },
      method: 'POST',
    })
  })

  it('should send password reset email without redirectTo', async () => {
    const req = createMockRequest('POST', {
      email: 'test@example.com',
    })

    const { POST } = await import('./route')

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
    const req = createMockRequest('POST', {})

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Email is required')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.forgetPassword).not.toHaveBeenCalled()
  })

  it('should handle empty email', async () => {
    const req = createMockRequest('POST', {
      email: '',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Email is required')

    const auth = await import('@/lib/auth')
    expect(auth.auth.api.forgetPassword).not.toHaveBeenCalled()
  })

  it('should handle auth service error with message', async () => {
    const errorMessage = 'User not found'

    mockAuthApi({
      forgetPasswordSuccess: false,
      forgetPasswordError: errorMessage,
    })

    const req = createMockRequest('POST', {
      email: 'nonexistent@example.com',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe(errorMessage)

    const logger = await import('@/lib/logs/console-logger')
    const mockLogger = logger.createLogger('ForgetPasswordTest')
    expect(mockLogger.error).toHaveBeenCalledWith('Error requesting password reset:', {
      error: expect.any(Error),
    })
  })

  it('should handle unknown error', async () => {
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

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe('Failed to send password reset email. Please try again later.')

    const logger = await import('@/lib/logs/console-logger')
    const mockLogger = logger.createLogger('ForgetPasswordTest')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
