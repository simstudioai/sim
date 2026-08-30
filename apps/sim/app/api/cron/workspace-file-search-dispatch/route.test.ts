/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueDispatch: vi.fn(),
  verifyCronAuth: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mocks.verifyCronAuth }))
vi.mock('@/lib/workspace-files/search/enqueue-dispatch', () => ({
  enqueueWorkspaceFileSearchDispatch: mocks.enqueueDispatch,
}))

import { GET } from '@/app/api/cron/workspace-file-search-dispatch/route'

function request() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/workspace-file-search-dispatch'
  )
}

describe('workspace file search dispatch route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyCronAuth.mockReturnValue(null)
  })

  it('returns as soon as Trigger.dev accepts the dispatcher run', async () => {
    mocks.enqueueDispatch.mockResolvedValue({ backend: 'trigger-dev', jobId: 'run-1' })

    const response = await GET(request())

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      success: true,
      triggered: true,
      backend: 'trigger-dev',
      jobId: 'run-1',
    })
  })

  it('returns the cron auth refusal without dispatching', async () => {
    mocks.verifyCronAuth.mockReturnValue(new Response(null, { status: 401 }))

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.enqueueDispatch).not.toHaveBeenCalled()
  })

  it('fails closed when Trigger.dev does not accept the dispatcher run', async () => {
    mocks.enqueueDispatch.mockRejectedValue(new Error('trigger unavailable'))

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Dispatcher enqueue failed',
    })
  })
})
