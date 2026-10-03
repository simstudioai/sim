import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMaskPIIBatch } = vi.hoisted(() => ({
  mockMaskPIIBatch: vi.fn(),
}))

const mockCheckInternalAuth = hybridAuthMockFns.mockCheckInternalAuth

vi.mock('@/lib/guardrails/validate_pii', () => ({
  maskPIIBatch: mockMaskPIIBatch,
}))

import { POST } from '@/app/api/guardrails/mask-batch/route'

describe('POST /api/guardrails/mask-batch', () => {
  beforeEach(() => {
    mockCheckInternalAuth.mockResolvedValue({ success: true })
    mockMaskPIIBatch.mockImplementation(async (texts: string[]) => texts.map((t) => `M(${t})`))
  })

  it('returns 401 without internal auth', async () => {
    mockCheckInternalAuth.mockResolvedValue({
      success: false,
      error: 'Internal authentication required',
    })

    const res = await POST(
      createMockRequest('POST', { texts: ['a@b.com'], entityTypes: ['EMAIL_ADDRESS'] })
    )

    expect(res.status).toBe(401)
    expect(mockMaskPIIBatch).not.toHaveBeenCalled()
  })
})
