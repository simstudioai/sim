/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueSweep: vi.fn(),
  verifyCronAuth: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mocks.verifyCronAuth }))
vi.mock('@/lib/knowledge/projection/enqueue', () => ({
  enqueueKnowledgeProjectionSweep: mocks.enqueueSweep,
}))

import { GET } from '@/app/api/cron/knowledge-projection/route'

function request() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/knowledge-projection'
  )
}

describe('knowledge projection sweep route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyCronAuth.mockReturnValue(null)
  })

  it('returns as soon as Trigger.dev accepts the pass', async () => {
    mocks.enqueueSweep.mockResolvedValue({
      triggered: true,
      backend: 'trigger-dev',
      jobId: 'run-1',
    })

    const response = await GET(request())

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      success: true,
      triggered: true,
      backend: 'trigger-dev',
      jobId: 'run-1',
    })
  })

  it('answers 200 without a pass when the projector has nothing to do', async () => {
    mocks.enqueueSweep.mockResolvedValue({ triggered: false, backend: null, jobId: null })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      triggered: false,
      backend: null,
      jobId: null,
    })
  })

  it('returns the cron auth refusal without enqueueing', async () => {
    mocks.verifyCronAuth.mockReturnValue(new Response(null, { status: 401 }))

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.enqueueSweep).not.toHaveBeenCalled()
  })

  it('fails closed when Trigger.dev does not accept the pass', async () => {
    mocks.enqueueSweep.mockRejectedValue(new Error('trigger unavailable'))

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Sweep enqueue failed',
    })
  })
})
