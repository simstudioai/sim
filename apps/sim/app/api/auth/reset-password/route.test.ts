/**
 * Tests for reset password API route
 *
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResetPassword, mockLogger } = vi.hoisted(() => {
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
    mockResetPassword: vi.fn(),
    mockLogger: logger,
  }
})

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      resetPassword: mockResetPassword,
    },
  },
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

import { POST } from '@/app/api/auth/reset-password/route'

describe('Reset Password API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResetPassword.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should reset password successfully', async () => {
    const req = createMockRequest('POST', {
      token: 'valid-reset-token',
      newPassword: 'newSecurePassword123!',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    expect(mockResetPassword).toHaveBeenCalledWith({
      body: {
        token: 'valid-reset-token',
        newPassword: 'newSecurePassword123!',
      },
      method: 'POST',
    })
  })

  it('should handle missing token', async () => {
    const req = createMockRequest('POST', {
      newPassword: 'newSecurePassword123',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Token is required')

    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('should handle missing new password', async () => {
    const req = createMockRequest('POST', {
      token: 'valid-reset-token',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Password is required')

    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('should handle empty token', async () => {
    const req = createMockRequest('POST', {
      token: '',
      newPassword: 'newSecurePassword123',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Token is required')

    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('should handle empty new password', async () => {
    const req = createMockRequest('POST', {
      token: 'valid-reset-token',
      newPassword: '',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Password must be at least 8 characters long')

    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('should handle auth service error with message', async () => {
    const errorMessage = 'Invalid or expired token'

    mockResetPassword.mockRejectedValue(new Error(errorMessage))

    const req = createMockRequest('POST', {
      token: 'invalid-token',
      newPassword: 'newSecurePassword123!',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe(errorMessage)

    expect(mockLogger.error).toHaveBeenCalledWith('Error during password reset:', {
      error: expect.any(Error),
    })
  })

  it('should handle unknown error', async () => {
    mockResetPassword.mockRejectedValue('Unknown error')

    const req = createMockRequest('POST', {
      token: 'valid-reset-token',
      newPassword: 'newSecurePassword123!',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe(
      'Failed to reset password. Please try again or request a new reset link.'
    )

    expect(mockLogger.error).toHaveBeenCalled()
  })
})
