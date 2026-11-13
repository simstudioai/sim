import { hybridAuthMockFns } from '@sim/testing/mocks/hybrid-auth.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/guardrails/mask-batch/route'

const mockCheckInternalAuth = hybridAuthMockFns.mockCheckInternalAuth

describe('POST /api/guardrails/mask-batch', () => {
  let presidioFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCheckInternalAuth.mockResolvedValue({ success: true })
    presidioFetch = vi.fn()
    vi.stubGlobal('fetch', presidioFetch)
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
    expect(presidioFetch).not.toHaveBeenCalled()
  })

  it.each([
    [
      '422 when Presidio rejects the input, so it is never resent',
      422,
      () => new Response('{}', { status: 422 }),
    ],
    [
      '503 when Presidio is unreachable, so it reads as an outage',
      503,
      () => Promise.reject(new TypeError('fetch failed')),
    ],
    [
      '500 for any other Presidio failure, retried on its own',
      500,
      () => new Response('boom', { status: 500 }),
    ],
  ] as const)('answers %s', async (_name, status, presidio) => {
    presidioFetch.mockImplementationOnce(presidio)

    const res = await POST(createMockRequest('POST', { texts: ['a'], entityTypes: [] }))

    expect(res.status).toBe(status)
  })
})
