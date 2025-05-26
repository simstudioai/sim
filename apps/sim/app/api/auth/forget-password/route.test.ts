/**
 * Tests for forget password API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Forget Password API Route', () => {
  const mockAuth = {
    api: {
      forgetPassword: vi.fn(),
    },
  }
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/lib/auth', () => ({
      auth: mockAuth,
    }))

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should send password reset email successfully', async () => {
    mockAuth.api.forgetPassword.mockResolvedValueOnce(undefined)

    const req = createMockRequest('POST', {
      email: 'test@example.com',
      redirectTo: 'https://example.com/reset',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockAuth.api.forgetPassword).toHaveBeenCalledWith({
      body: {
        email: 'test@example.com',
        redirectTo: 'https://example.com/reset',
      },
      method: 'POST',
    })
  })

  it('should send password reset email without redirectTo', async () => {
    mockAuth.api.forgetPassword.mockResolvedValueOnce(undefined)

    const req = createMockRequest('POST', {
      email: 'test@example.com',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockAuth.api.forgetPassword).toHaveBeenCalledWith({
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
    expect(mockAuth.api.forgetPassword).not.toHaveBeenCalled()
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
    expect(mockAuth.api.forgetPassword).not.toHaveBeenCalled()
  })

  it('should handle auth service error with message', async () => {
    const errorMessage = 'User not found'
    mockAuth.api.forgetPassword.mockRejectedValueOnce(new Error(errorMessage))

    const req = createMockRequest('POST', {
      email: 'nonexistent@example.com',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe(errorMessage)
    expect(mockLogger.error).toHaveBeenCalledWith('Error requesting password reset:', {
      error: expect.any(Error),
    })
  })

  it('should handle unknown error', async () => {
    mockAuth.api.forgetPassword.mockRejectedValueOnce('Unknown error')

    const req = createMockRequest('POST', {
      email: 'test@example.com',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe('Failed to send password reset email. Please try again later.')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
