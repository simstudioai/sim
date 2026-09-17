/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), verifyCronAuth: vi.fn() }))
vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mocks.verifyCronAuth }))
vi.mock('@/lib/core/outbox/enqueue', () => ({ enqueueOutboxProcessor: mocks.enqueue }))

import { GET } from '@/app/api/webhooks/outbox/process/route'

const request = () =>
  createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/webhooks/outbox/process')

describe('outbox cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyCronAuth.mockReturnValue(null)
  })
  it('authenticates before accepting any background work', async () => {
    mocks.verifyCronAuth.mockReturnValue(new Response(null, { status: 401 }))
    expect((await GET(request())).status).toBe(401)
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
  it('acknowledges a durably accepted task with 202', async () => {
    mocks.enqueue.mockResolvedValue({ backend: 'trigger-dev', jobId: 'run-1' })
    const response = await GET(request())
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      success: true,
      requestId: expect.any(String),
      triggered: true,
      backend: 'trigger-dev',
      jobId: 'run-1',
    })
  })
  it('preserves the existing 200 response for synchronous self-hosted runs', async () => {
    const output = {
      result: { processed: 1, retried: 0, deadLettered: 0, leaseLost: 0, reaped: 0 },
      reapedBackgroundWork: 0,
      recoveredDocuments: 0,
    }
    mocks.enqueue.mockResolvedValue({ backend: 'inline', output })
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      requestId: expect.any(String),
      ...output,
    })
  })
  it('returns an error when durable acceptance fails', async () => {
    mocks.enqueue.mockRejectedValue(new Error('Trigger unavailable'))
    const response = await GET(request())
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Trigger unavailable',
    })
  })
})
