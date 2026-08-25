/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueue, mockGetJobQueue, mockVerifyCronAuth } = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockVerifyCronAuth: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: mockGetJobQueue }))

import { GET } from '@/app/api/cron/cleanup-table-row-ttl/route'

describe('table row TTL cleanup route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T17:12:00Z'))
    mockVerifyCronAuth.mockReturnValue(null)
    mockEnqueue.mockResolvedValue('job-ttl-1')
    mockGetJobQueue.mockResolvedValue({ enqueue: mockEnqueue })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enqueues one serialized cleanup job', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/cron/cleanup-table-row-ttl'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ triggered: true, jobId: 'job-ttl-1' })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'cleanup-table-row-ttl',
      {},
      expect.objectContaining({
        maxAttempts: 1,
        jobId: 'cleanup-table-row-ttl:5958062',
        concurrencyKey: 'cleanup:table-row-ttl',
        concurrencyLimit: 1,
        runner: expect.any(Function),
      })
    )
  })

  it('deduplicates retries within the same five-minute schedule window', async () => {
    const request = () =>
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/cron/cleanup-table-row-ttl'
      )

    await GET(request())
    vi.advanceTimersByTime(2 * 60 * 1000)
    await GET(request())

    expect(mockEnqueue.mock.calls[0]?.[2]?.jobId).toBe(mockEnqueue.mock.calls[1]?.[2]?.jobId)
  })

  it('returns the cron auth refusal without touching the queue', async () => {
    mockVerifyCronAuth.mockReturnValue(new Response(null, { status: 401 }))

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/cron/cleanup-table-row-ttl'
      )
    )

    expect(response.status).toBe(401)
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })
})
