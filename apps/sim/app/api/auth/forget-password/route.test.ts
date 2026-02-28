/**
 * Tests for forget password API route
 *
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockForgetPassword, mockLogger } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  return {
    mockForgetPassword: vi.fn(),
    mockLogger: logger,
  }
})

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn(() => 'https://app.example.com'),
}))
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      forgetPassword: mockForgetPassword,
    },
  },
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

import { POST } from '@/app/api/auth/forget-password/route'

describe('Forget Password API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockForgetPassword.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should send password reset email successfully with same-origin redirectTo', async () => {
    const req = createMockRequest('POST', {
      email: 'test@example.com',
      redirectTo: 'https://app.example.com/reset',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    expect(mockForgetPassword).toHaveBeenCalledWith({
      body: {
        email: 'test@example.com',
        redirectTo: 'https://app.example.com/reset',
      },
      method: 'POST',
    })
  })

  it('should reject external redirectTo URL', async () => {
    const req = createMockRequest('POST', {
      email: 'test@example.com',
      redirectTo: 'https://evil.com/phishing',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Redirect URL must be a valid same-origin URL')

    expect(mockForgetPassword).not.toHaveBeenCalled()
  })

  it('should send password reset email without redirectTo', async () => {
    const req = createMockRequest('POST', {
      email: 'test@example.com',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    expect(mockForgetPassword).toHaveBeenCalledWith({
      body: {
        email: 'test@example.com',
        redirectTo: undefined,
      },
      method: 'POST',
    })
  })

  it('should handle missing email', async () => {
    const req = createMockRequest('POST', {})

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Email is required')

    expect(mockForgetPassword).not.toHaveBeenCalled()
  })

  it('should handle empty email', async () => {
    const req = createMockRequest('POST', {
      email: '',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Please provide a valid email address')

    expect(mockForgetPassword).not.toHaveBeenCalled()
  })

  it('should handle auth service error with message', async () => {
    const errorMessage = 'User not found'

    mockForgetPassword.mockRejectedValue(new Error(errorMessage))

    const req = createMockRequest('POST', {
      email: 'nonexistent@example.com',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe(errorMessage)

    expect(mockLogger.error).toHaveBeenCalledWith('Error requesting password reset:', {
      error: expect.any(Error),
    })
  })

  it('should handle unknown error', async () => {
    mockForgetPassword.mockRejectedValue('Unknown error')

    const req = createMockRequest('POST', {
      email: 'test@example.com',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe('Failed to send password reset email. Please try again later.')

    expect(mockLogger.error).toHaveBeenCalled()
  })
})
