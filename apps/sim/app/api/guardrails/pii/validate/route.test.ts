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
})
