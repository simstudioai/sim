/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockValidatePII } = vi.hoisted(() => ({
  mockValidatePII: vi.fn(),
}))

vi.mock('@/lib/guardrails/validate_pii', () => ({
  validatePII: mockValidatePII,
}))

import { POST } from '@/app/api/guardrails/pii/validate/route'

describe('POST /api/guardrails/pii/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({ success: true })
    mockValidatePII.mockResolvedValue({ passed: true, detectedEntities: [] })
  })

  it('authenticates before validating the request body', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: false,
      error: 'Internal authentication required',
    })

    const response = await POST(createMockRequest('POST', { text: 42 }))

    expect(response.status).toBe(401)
    expect(mockValidatePII).not.toHaveBeenCalled()
  })

  it('runs Presidio validation inside the app boundary', async () => {
    const request = createMockRequest('POST', {
      text: 'email a@b.com',
      entityTypes: ['EMAIL_ADDRESS'],
      mode: 'mask',
      language: 'en',
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ passed: true, detectedEntities: [] })
    expect(mockValidatePII).toHaveBeenCalledWith({
      text: 'email a@b.com',
      entityTypes: ['EMAIL_ADDRESS'],
      mode: 'mask',
      language: 'en',
      customPatterns: undefined,
      requestId: 'mock-request-id',
      abortSignal: request.signal,
    })
  })

  it('rejects malformed input before calling Presidio', async () => {
    const response = await POST(
      createMockRequest('POST', { text: 'claim', entityTypes: [], mode: 'invalid' })
    )

    expect(response.status).toBe(400)
    expect(mockValidatePII).not.toHaveBeenCalled()
  })
})
