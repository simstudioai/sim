/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckInternalAuth, mockMaskPIIBatch } = vi.hoisted(() => ({
  mockCheckInternalAuth: vi.fn(),
  mockMaskPIIBatch: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: mockCheckInternalAuth,
}))

vi.mock('@/lib/guardrails/validate_pii', () => ({
  maskPIIBatch: mockMaskPIIBatch,
}))

import { POST } from '@/app/api/guardrails/mask-batch/route'

describe('POST /api/guardrails/mask-batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('masks the batch in-process and preserves order', async () => {
    const res = await POST(
      createMockRequest('POST', {
        texts: ['a@b.com', 'hello'],
        entityTypes: ['EMAIL_ADDRESS'],
        language: 'en',
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.masked).toEqual(['M(a@b.com)', 'M(hello)'])
    expect(mockMaskPIIBatch).toHaveBeenCalledWith(
      ['a@b.com', 'hello'],
      ['EMAIL_ADDRESS'],
      'en',
      undefined
    )
  })

  it('rejects an invalid body with 400', async () => {
    const res = await POST(createMockRequest('POST', { texts: 'not-an-array', entityTypes: [] }))

    expect(res.status).toBe(400)
    expect(mockMaskPIIBatch).not.toHaveBeenCalled()
  })
})
